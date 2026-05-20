/**
 * Graduation keeper. Runs on the API Worker's `scheduled()` cron tick and
 * drives phase 2 of the two-phase graduation flow.
 *
 * Two-phase graduation, recap:
 *   - Phase 1 fires inline on the threshold-crossing buy. Cheap (~700-800k
 *     gas), fits comfortably in HyperEVM's small-block ceiling. Emits
 *     `Bonding.TokenGraduating`. Trading is now contract-frozen
 *     (`Zap.buy/sell` revert with `TokenIsGraduating`).
 *   - Phase 2 is `Bonding.finalizeGraduation(token)`. ~2.5M gas because it
 *     creates the HyperSwap pair + calls `pair.mint(lpLock)`. Needs big
 *     blocks. **Permissionless** — anyone can call. The keeper handles the
 *     happy path so the typical token graduates within ~60s of phase 1.
 *
 * What this module does, every cron tick:
 *   1. Query the indexer's `ponder_views.token` table directly for tokens
 *      with `pendingGraduation: true, graduated: false`. Reads through
 *      `fetchPendingGraduationTokens`, which talks to the same Neon database
 *      Ponder writes — same physical rows the GraphQL layer used to expose,
 *      just without the GraphQL hop.
 *   2. For each, fire-and-forget `finalizeGraduation` from the keeper wallet
 *      with manually-managed nonces. We do NOT wait for receipts —
 *      submission itself is sub-second per tx, but big-block confirmation is
 *      ~60s and waiting sequentially for several of those would push past
 *      the next 1-minute cron tick. The indexer is the source of truth for
 *      "did this finalize land": next tick's read naturally filters out
 *      tokens whose `Bonding:TokenGraduated` handler has flipped the flag.
 *   3. Log + swallow failures — `finalizeGraduation` reverts cleanly on
 *      already-graduated tokens (race with another caller, e.g. an
 *      arbitrageur who beat us to it), so retries are safe and idempotent.
 *      A failed-to-submit tx leaves its nonce slot reusable for the next tx
 *      in the same batch.
 *
 * Operational setup (one-time):
 *   - `KEEPER_PRIVATE_KEY` worker secret. Fresh wallet, never reuse the
 *     deployer key. Fund with ~5 HYPE.
 *   - Toggle big blocks ON for the keeper wallet (Hyperliquid L1 setting,
 *     persists per wallet). See `packages/contracts/scripts/toggle-big-blocks.mjs`.
 *   - Optional `HYPEREVM_RPC_URL` override; defaults to the public RPC.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { BondingAbi, CONTRACT_ADDRESSES, HYPER_EVM } from "@launchpad/shared";

import { createDb } from "../db/client.js";
import { fetchPendingGraduationTokens } from "./indexer-reads.js";
import type { AppBindings } from "./types.js";

/**
 * Cap on submissions per cron tick. Bounded so a flood of pending tokens
 * can't keep the worker busy past the next tick. Each submission is sub-second
 * (no receipt wait), so even 5 sequential txs cost ~5s wall-clock total — well
 * inside the cron budget. Anything beyond the cap waits for the next tick.
 */
const MAX_FINALIZES_PER_TICK = 5;

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

/**
 * Single keeper sweep. Idempotent — calling twice in quick succession is
 * fine (the second call's writes will revert on `NotGraduating` because
 * the first call moved the lifecycle to `Graduated`).
 */
export async function runGraduationKeeper(env: AppBindings): Promise<void> {
  const pkRaw = env.KEEPER_PRIVATE_KEY;
  if (!pkRaw || pkRaw.length === 0) {
    log("warn", "keeper_disabled_no_key", {});
    return;
  }
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as `0x${string}`;

  const db = createDb(env.HYPERDRIVE.connectionString);
  const pending = await fetchPendingGraduationTokens(db);
  if (pending === null) {
    // Null = DB read failed (see helper docstring). Skip this tick rather
    // than retrying with stale data — matches the prior GraphQL-null
    // behaviour, and the event name stays the same so existing log alerts
    // don't have to be rewired.
    log("warn", "keeper_ponder_unreachable", {});
    return;
  }
  if (pending.length === 0) return;

  const account = privateKeyToAccount(pk);
  const rpcUrl = env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl;
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  // Oldest-first slicing (helper returns `pendingGraduationAt asc`, matching
  // the prior GraphQL ordering). FIFO fairness: when we're behind, the user
  // who's been staring at the graduating overlay the longest gets unblocked
  // first. Any newer entries wait for the next tick and will be retried —
  // `pendingGraduation` stays true until phase 2 lands.
  const batch = pending.slice(0, MAX_FINALIZES_PER_TICK);

  // Manual nonce management — viem's wallet client queries the RPC's `pending`
  // count per call, which can return the same nonce twice for back-to-back
  // submissions before the first tx propagates. Fetch once, increment locally
  // per successful submit. A failed submit leaves the slot reusable.
  const startNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  let submitted = 0;

  for (const t of batch) {
    const nonce = startNonce + submitted;
    // Indexer stores addresses lowercased; viem's writeContract accepts any
    // valid 20-byte hex, checksummed or not. Cast at the boundary so the
    // ABI's `address` argument type is satisfied without an extra
    // `getAddress(...)` round-trip on the hot path.
    const tokenAddress = t.address as `0x${string}`;
    try {
      const hash = await wallet.writeContract({
        address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
        abi: BondingAbi,
        functionName: "finalizeGraduation",
        args: [tokenAddress],
        nonce,
      });
      submitted++;
      log("info", "keeper_tx_submitted", { token: tokenAddress, hash, nonce });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Submission failures don't consume the local nonce (the tx never
      // went out). The most common cause is a race with another finalizer:
      // viem's pre-flight `eth_call` simulates against latest state and
      // reverts with `NotGraduating` if the token already finalized. The
      // contract's idempotency keeps us safe — next tick won't see this
      // token in the GraphQL result.
      log("warn", "keeper_tx_failed", {
        token: tokenAddress,
        nonce,
        error: message,
      });
    }
  }
}

function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level,
      event,
      ...fields,
      timestamp: new Date().toISOString(),
    }),
  );
}
