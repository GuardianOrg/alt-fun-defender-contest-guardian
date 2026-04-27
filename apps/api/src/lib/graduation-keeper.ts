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
 *   1. Query Ponder for tokens with `pendingGraduation: true, graduated: false`.
 *   2. For each, broadcast `finalizeGraduation` from the keeper wallet.
 *   3. Log + swallow failures — `finalizeGraduation` reverts cleanly on
 *      already-graduated tokens (race with another caller, e.g. an
 *      arbitrageur who beat us to it), so retries are safe and idempotent.
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

import { createPonderQuery } from "./ponder-client.js";
import type { AppBindings } from "./types.js";

/** Cap so a flood of pending tokens doesn't blow the cron's 30s budget. */
const MAX_FINALIZES_PER_TICK = 5;

/** Per-tx wait timeout — big blocks confirm ~60s, leave headroom. */
const RECEIPT_TIMEOUT_MS = 90_000;

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

interface PendingToken {
  address: `0x${string}`;
  pendingGraduationAt: string | null;
}

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

  const pending = await fetchPendingTokens(env.PONDER_URL);
  if (pending === null) {
    log("warn", "keeper_ponder_unreachable", {});
    return;
  }
  if (pending.length === 0) return;

  const account = privateKeyToAccount(pk);
  const rpcUrl = env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl;
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  // Newest-first slicing is intentional: if we're behind, finalize the
  // freshest tokens first (best UX for users watching the overlay) and let
  // any older stragglers wait for the next tick. They will be retried —
  // `pendingGraduation` stays true until phase 2 lands.
  const batch = pending.slice(0, MAX_FINALIZES_PER_TICK);

  for (const t of batch) {
    try {
      const hash = await wallet.writeContract({
        address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
        abi: BondingAbi,
        functionName: "finalizeGraduation",
        args: [t.address],
      });
      log("info", "keeper_tx_submitted", { token: t.address, hash });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
      });
      log("info", "keeper_tx_confirmed", {
        token: t.address,
        hash,
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Most expected failure: another caller (arbitrageur, manual rescue)
      // beat us to finalize. The contract reverts with `NotGraduating` and
      // we move on; the indexer will reconcile state on its next block.
      log("warn", "keeper_tx_failed", { token: t.address, error: message });
    }
  }
}

async function fetchPendingTokens(
  ponderUrl: string | undefined,
): Promise<PendingToken[] | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{
    tokens: { items: PendingToken[] };
  }>(
    `query {
      tokens(
        where: { pendingGraduation: true, graduated: false }
        limit: 50
        orderBy: "pendingGraduationAt"
        orderDirection: "asc"
      ) {
        items {
          address
          pendingGraduationAt
        }
      }
    }`,
  );
  if (data === null) return null;
  return data.tokens.items;
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
