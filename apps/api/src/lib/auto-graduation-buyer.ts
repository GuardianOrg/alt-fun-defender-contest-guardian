/**
 * Auto-graduation keeper. Runs on the API Worker's `scheduled()` cron
 * tick and triggers phase 1 of graduation for tokens that have been
 * pushed past the USD threshold by LT price appreciation alone (i.e.
 * without a buy since the LT rallied).
 *
 * Why this exists, in one paragraph
 * ---------------------------------
 * Graduation phase 1 is fired inline at the end of any `Zap.buy` whose
 * post-buy `realLT × exchangeRate ≥ Bonding.graduationThresholdUsd`.
 * Normally the threshold-crossing buy is itself a user buy and there's
 * nothing for us to do — the existing graduation **finalize** keeper
 * (`graduation-keeper.ts`) only drives phase 2 once phase 1 has fired.
 * But because the curve reserve is a leveraged token, the USD value of
 * the reserve can drift past the threshold *with no buys at all*: a user
 * funds the curve close to the threshold, stops, and the LT then rallies
 * on its own. The contract is satisfied (`canGraduate(token) == true`)
 * but no user is in the loop to land the triggering buy. Without this
 * keeper the token sits in that limbo until the next user buy of any
 * size, which can be hours or days.
 *
 * The keeper closes that gap by calling the permissionless
 * `Bonding.triggerGraduation(token)` entry point, which runs the same
 * `_enterGraduating` flow the inline post-buy trigger uses but without
 * needing a buy. No USDC, no LT, no token positions accumulated — pure
 * mechanical trigger.
 *
 * Two phases per cron tick
 * ------------------------
 * 1. **Trigger phase.** Sweep curve-phase tokens, filter to those where
 *    `Bonding.canGraduate(token) == true`, fire one
 *    `Bonding.triggerGraduation(token)` per match.
 * 2. **Sell phase.** Defensive: any token positions accumulated by the
 *    legacy `Zap.buy`-trigger flow before the switch to
 *    `triggerGraduation` are drained back to USDC via `Zap.sell`. The
 *    new trigger flow doesn't create positions, so this phase is a
 *    no-op once any historical inventory is gone.
 *
 * Wallet separation from the finalize keeper (intentional)
 * --------------------------------------------------------
 * The finalize keeper (`KEEPER_PRIVATE_KEY`) is on **big blocks** for
 * the ~2.5M-gas `Bonding.finalizeGraduation` call. This keeper must
 * stay on **small blocks** so its sub-second triggers/sells aren't
 * queued behind the finalize keeper's ~60s big-block confirmations.
 * Because Hyperliquid L1's small/big-block toggle is sticky per-wallet,
 * the two keepers MUST be different wallets — never reuse keys. Setup
 * checklist for this wallet:
 *   1. Generate a fresh key — DO NOT reuse `KEEPER_PRIVATE_KEY` or
 *      the deployer key.
 *   2. Fund with HYPE for gas (each trigger is one ~120k-gas tx; sells
 *      are one or two depending on whether the token approval is
 *      already in place).
 *   3. **Leave big blocks OFF** (default). If the wallet was ever
 *      toggled on, run
 *        `DEPLOYER_PRIVATE_KEY=<this key> node packages/contracts/scripts/toggle-big-blocks.mjs off`
 *      to flip back to small blocks before deploying the secret.
 *   4. `wrangler secret put AUTO_GRADUATION_BUYER_PRIVATE_KEY` for
 *      prod / preview.
 *
 * Idempotency / safety properties
 * --------------------------------
 *   - `Bonding.canGraduate` is the same view `triggerGraduation`
 *     re-checks on-chain, so a `true` reply here means the trigger
 *     will succeed (modulo LT rate drift between read and tx — rare,
 *     and the failed submit drops out cleanly with `NotGraduatable`).
 *   - `triggerGraduation` reverts with `TokenIsGraduating` if another
 *     caller (or a buy that crossed the threshold) beat us to it —
 *     safely caught and logged, not a double-trigger.
 *   - `Zap.sell` reverts on `Graduating` lifecycle. Filter on the
 *     authoritative `Bonding.isGraduating` view so we only attempt
 *     sells in `Curve` or `Graduated`.
 *   - Per-tick caps (`MAX_TRIGGERS_PER_TICK`, `MAX_SELLS_PER_TICK`)
 *     bound wall-clock per tick.
 *   - All txs use manually-managed sequential nonces, matching
 *     `graduation-keeper.ts` — viem's pending-nonce auto-fetch double-
 *     counts on rapid back-to-back submits.
 *   - Per-token approvals for sells use the one-time `MAX_UINT256`
 *     pattern.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  BondingAbi,
  CONTRACT_ADDRESSES,
  HYPER_EVM,
  TokenAbi,
  ZapAbi,
} from "@launchpad/shared";

import { createDb } from "../db/client.js";
import {
  fetchCurvePhaseTokens,
  fetchNonZeroWalletZapPositions,
} from "./indexer-reads.js";
import type { AppBindings } from "./types.js";

/**
 * Standard deterministic Multicall3 deployment — confirmed live on
 * HyperEVM at the canonical address. We pass it explicitly here
 * because the shared `HYPER_EVM` chain object doesn't carry a
 * `contracts.multicall3` slot (the rest of the API doesn't currently
 * use multicall3), so viem can't auto-discover it.
 */
const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/**
 * Cap on `Bonding.triggerGraduation` submissions per cron tick. Each
 * submission is sub-second (no receipt wait), so even at the cap the
 * trigger phase costs ~5s wall-clock — well inside the ~30s cron
 * budget shared with the other `scheduled()` jobs. A flood of newly-
 * eligible tokens (e.g. an LT spikes 50% in a minute and pushes 20
 * tokens over their thresholds at once) drains across multiple ticks.
 */
const MAX_TRIGGERS_PER_TICK = 5;

/**
 * Cap on `Zap.sell` submissions per cron tick. Sells are 2 txs each
 * (one-time `Token.approve` then `Zap.sell`) so the per-tick budget
 * is tighter than the buy phase. Stranded positions naturally drain
 * over subsequent ticks.
 */
const MAX_SELLS_PER_TICK = 5;

/**
 * Pre-filter pool size pulled from the indexer for the buy phase. We
 * multicall `canGraduate` against this set every tick to find
 * triggerable tokens. 500 is comfortably more than the live token
 * count today; if we ever outgrow it we should switch to a
 * `usdFilled`-keyed pre-filter rather than blindly raising the cap.
 */
const CURVE_TOKEN_FETCH_LIMIT = 500;

/**
 * Pre-filter pool size pulled from the indexer for the sell phase. The
 * keeper's wallet only ever holds positions it acquired itself
 * (legacy holdings from the previous `Zap.buy`-trigger flow); the
 * current `triggerGraduation` flow doesn't accumulate any. 200 is
 * far more than the legacy backlog could ever produce.
 */
const POSITION_FETCH_LIMIT = 200;

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

/**
 * Narrow ABI subsets used exclusively by this keeper's multicall reads.
 * Keeping these local (instead of importing the full `BondingAbi` /
 * `TokenAbi`) collapses the generic instantiation tree viem walks for
 * `multicall`'s return-type inference — the full ABIs blow past
 * tsc's recursion limit when used as the `abi` field on every contract
 * in a `multicall.contracts` array.
 */
const CAN_GRADUATE_ABI = parseAbi([
  "function canGraduate(address) view returns (bool)",
]);
const IS_GRADUATING_ABI = parseAbi([
  "function isGraduating(address) view returns (bool)",
]);
const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
]);


/**
 * Single keeper sweep. Idempotent — a second invocation in the same
 * tick (e.g. retried after a transient throw) replays the same
 * Ponder query and the same on-chain state lookups; any tokens whose
 * lifecycle moved past `Curve` between calls drop out naturally
 * because `canGraduate` flips to `false`, and any positions whose
 * lifecycle entered `Graduating` are skipped by the per-token
 * `isGraduating` filter.
 */
export async function runAutoGraduationBuyer(
  env: AppBindings,
): Promise<void> {
  const pkRaw = env.AUTO_GRADUATION_BUYER_PRIVATE_KEY;
  if (!pkRaw || pkRaw.length === 0) {
    log("warn", "auto_buyer_disabled_no_key", {});
    return;
  }
  const pk = normalizePrivateKey(pkRaw);
  const account = privateKeyToAccount(pk);

  // Hard guard against the keepers sharing one wallet. The cooperation
  // model documented in `apps/api/AGENTS.md` requires the finalize
  // keeper to sit on big blocks (~60s confirms for the 2.5M-gas
  // `finalizeGraduation`) and this keeper to sit on small blocks (~1s
  // confirms for sub-second trigger buys). Hyperliquid L1's block-size
  // toggle is sticky per wallet, so a single wallet can only target one
  // regime at a time — silently misconfiguring both keepers to the same
  // key would leave one of them perpetually queued behind the other's
  // confirmations. Refuse to operate in that state instead of letting
  // it manifest as user-visible graduation latency.
  //
  // Failure modes for the finalize key: missing (skip the check —
  // single-keeper deployment is supported), invalid (log and continue;
  // we don't want a typo in the OTHER keeper's secret to brick this
  // keeper). Only the matching-address case aborts.
  const finalizePkRaw = env.KEEPER_PRIVATE_KEY;
  if (finalizePkRaw && finalizePkRaw.length > 0) {
    try {
      const finalizeAccount = privateKeyToAccount(
        normalizePrivateKey(finalizePkRaw),
      );
      if (
        finalizeAccount.address.toLowerCase() ===
        account.address.toLowerCase()
      ) {
        log("error", "auto_buyer_disabled_same_wallet", {
          address: account.address,
        });
        return;
      }
    } catch (err) {
      log("warn", "auto_buyer_finalize_key_parse_failed", {
        error: errMessage(err),
      });
    }
  }

  const rpcUrl = env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl;
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  // Single source-of-truth nonce, incremented locally on every successful
  // submission. `pending` blocktag accounts for txs we submitted in
  // earlier ticks that haven't confirmed yet — same pattern as
  // `graduation-keeper.ts`. A failed submit (pre-flight `eth_call`
  // revert) doesn't consume the slot, so the next loop iteration
  // reuses it.
  let nonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });

  // ─── Trigger phase ─────────────────────────────────────────────────
  nonce = await runTriggerPhase(env, publicClient, wallet, nonce);

  // ─── Sell phase ────────────────────────────────────────────────────
  await runSellPhase(env, publicClient, wallet, account.address, nonce);
}

type PublicClientT = ReturnType<typeof createPublicClient>;
// Capturing the wallet client's full parameter shape — including the
// bound `LocalAccount` from `privateKeyToAccount(pk)` — keeps the
// `writeContract` call signature seeing the bound account, so each
// site is free to omit `account` (which forces JSON-RPC unsigned
// sends if mis-passed; see the per-call comments below). Without
// this specialisation `ReturnType<typeof createWalletClient>` widens
// to `WalletClient<Transport, Chain | undefined, Account | undefined>`
// and the call site's TypeScript signature demands an `account`
// argument, tempting future contributors to pass an Address string
// (the original CodeRabbit-flagged bug).
type LocalAccountT = ReturnType<typeof privateKeyToAccount>;
type WalletClientT = ReturnType<
  typeof createWalletClient<HttpTransportT, typeof chain, LocalAccountT>
>;
type HttpTransportT = ReturnType<typeof http>;

async function runTriggerPhase(
  env: AppBindings,
  publicClient: PublicClientT,
  wallet: WalletClientT,
  startNonce: number,
): Promise<number> {
  const db = createDb(env.HYPERDRIVE.connectionString);
  const candidates = await fetchCurvePhaseTokens(db, CURVE_TOKEN_FETCH_LIMIT);
  if (candidates === null) {
    // Null = DB read failed. Keep the existing event name so on-call alerts
    // don't need to be rewired during the migration — semantically still
    // "indexer unreachable", just over a different transport.
    log("warn", "auto_buyer_ponder_unreachable", { phase: "trigger" });
    return startNonce;
  }
  if (candidates.length === 0) return startNonce;

  // Authoritative on-chain check. `Bonding.canGraduate` returns true
  // only when (a) the token exists, (b) lifecycle == Curve, AND (c)
  // either supply has sold out OR `realLT × exchangeRate ≥ threshold`.
  // (a) and (b) filter out anything that isn't a valid trigger target;
  // (c) is the actual signal. `Bonding.triggerGraduation` re-checks
  // all three on-chain so a stale-by-one-block `true` here just gets
  // rejected with a clean `NotGraduatable` revert.
  // Indexer stores addresses lowercased; viem/multicall accept any valid
  // 20-byte hex regardless of casing, so cast at the boundary and skip the
  // extra `getAddress(...)` per row.
  const canGraduateResults = await publicClient.multicall({
    multicallAddress: MULTICALL3_ADDRESS,
    allowFailure: true,
    contracts: candidates.map((t) => ({
      address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
      abi: CAN_GRADUATE_ABI,
      functionName: "canGraduate" as const,
      args: [t.address as `0x${string}`] as const,
    })),
  });

  const triggerable: `0x${string}`[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = canGraduateResults[i];
    if (r && r.status === "success" && r.result === true) {
      const candidate = candidates[i];
      if (candidate) triggerable.push(candidate.address as `0x${string}`);
    }
  }

  if (triggerable.length === 0) return startNonce;

  let nonce = startNonce;
  let submitted = 0;
  for (const tokenAddr of triggerable) {
    if (submitted >= MAX_TRIGGERS_PER_TICK) break;
    try {
      // `account` and `chain` are intentionally omitted — they
      // default to the `LocalAccount` and `chain` bound at
      // `createWalletClient({ account, chain, transport })`. Passing
      // `account: bot` (an Address string) here would override the
      // bound LocalAccount and force viem onto JSON-RPC's
      // `eth_sendTransaction`, which Alchemy and other public RPCs
      // don't support (they require pre-signed payloads via
      // `eth_sendRawTransaction`). The precise `WalletClientT` type
      // declared above keeps this call-site signature happy without
      // either override.
      const hash = await wallet.writeContract({
        address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
        abi: BondingAbi,
        functionName: "triggerGraduation",
        args: [tokenAddr],
        nonce,
      });
      log("info", "auto_buyer_trigger_submitted", {
        token: tokenAddr,
        hash,
        nonce,
      });
      submitted++;
      nonce++;
    } catch (err) {
      // Most likely cause: race with a real user buy that landed first
      // and flipped lifecycle to `Graduating` (Bonding reverts with
      // `TokenIsGraduating`); or LT rate drift between our
      // `canGraduate` read and the trigger landing
      // (`NotGraduatable`). All recoverable next tick. No local nonce
      // consumed (submission never broadcast).
      log("warn", "auto_buyer_trigger_failed", {
        token: tokenAddr,
        nonce,
        error: errMessage(err),
      });
    }
  }

  return nonce;
}

async function runSellPhase(
  env: AppBindings,
  publicClient: PublicClientT,
  wallet: WalletClientT,
  bot: `0x${string}`,
  startNonce: number,
): Promise<number> {
  // `fetchNonZeroWalletZapPositions` lower-cases the wallet at the boundary,
  // so passing the checksummed `account.address` is safe.
  const db = createDb(env.HYPERDRIVE.connectionString);
  const rawPositions = await fetchNonZeroWalletZapPositions(
    db,
    bot,
    POSITION_FETCH_LIMIT,
  );
  if (rawPositions === null) {
    log("warn", "auto_buyer_ponder_unreachable", { phase: "sell" });
    return startNonce;
  }
  if (rawPositions.length === 0) return startNonce;
  // Helper returns `tokenAddress: string` (indexer storage is lowercased).
  // Cast to viem's hex-address shape once so downstream multicall + write
  // sites stay typed without an extra `getAddress(...)` per row.
  const positions = rawPositions.map((p) => ({
    tokenAddress: p.tokenAddress as `0x${string}`,
  }));

  // Three reads per token. Split across two multicalls — one for the
  // ERC20 reads (balance + allowance), one for `Bonding.isGraduating`.
  // The split is purely a TS-inference concession: viem's
  // `multicall.contracts` array can't carry mixed ABI types without
  // its return-type generic recursing past tsc's depth limit. Two
  // typed batches are equivalent at the wire level (still a single
  // eth_call each via Multicall3's `aggregate3`).
  //
  //   1. `Token.balanceOf(bot)` — authoritative current holding
  //      (Ponder's `walletPosition.zapTokenAmount` can lag by a
  //      block, and we want the exact amount we still own).
  //   2. `Token.allowance(bot, zap)` — drives the one-time
  //      MAX_UINT256 approve gate.
  //   3. `Bonding.isGraduating(token)` — `Zap.sell` reverts in the
  //      `Graduating` window; we skip rather than burn a nonce on
  //      a guaranteed revert.
  const erc20Contracts = positions.flatMap((p) => [
    {
      address: p.tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf" as const,
      args: [bot] as const,
    },
    {
      address: p.tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "allowance" as const,
      args: [bot, CONTRACT_ADDRESSES.zap as `0x${string}`] as const,
    },
  ]);

  const isGraduatingContracts = positions.map((p) => ({
    address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
    abi: IS_GRADUATING_ABI,
    functionName: "isGraduating" as const,
    args: [p.tokenAddress] as const,
  }));

  const [erc20Results, isGraduatingResults] = await Promise.all([
    publicClient.multicall({
      multicallAddress: MULTICALL3_ADDRESS,
      allowFailure: true,
      contracts: erc20Contracts,
    }),
    publicClient.multicall({
      multicallAddress: MULTICALL3_ADDRESS,
      allowFailure: true,
      contracts: isGraduatingContracts,
    }),
  ]);

  let nonce = startNonce;
  let submitted = 0;

  for (let i = 0; i < positions.length; i++) {
    if (submitted >= MAX_SELLS_PER_TICK) break;

    const position = positions[i];
    if (!position) continue;

    const balanceR = erc20Results[i * 2];
    const allowanceR = erc20Results[i * 2 + 1];
    const isGraduatingR = isGraduatingResults[i];

    if (
      !balanceR ||
      balanceR.status !== "success" ||
      !allowanceR ||
      allowanceR.status !== "success" ||
      !isGraduatingR ||
      isGraduatingR.status !== "success"
    ) {
      log("warn", "auto_buyer_sell_lookup_failed", {
        token: position.tokenAddress,
      });
      continue;
    }

    const balance = balanceR.result;
    const allowance = allowanceR.result;
    const isGraduating = isGraduatingR.result;

    if (balance === 0n) continue;
    if (isGraduating) {
      // Wait for the finalize keeper to flip the lifecycle past
      // `Graduating`. Sell will land on the next tick that sees
      // `isGraduating == false`.
      continue;
    }

    if (allowance < balance) {
      try {
        const hash = await wallet.writeContract({
          address: position.tokenAddress,
          abi: TokenAbi,
          functionName: "approve",
          args: [CONTRACT_ADDRESSES.zap as `0x${string}`, maxUint256],
          nonce,
        });
        log("info", "auto_buyer_token_approve_submitted", {
          token: position.tokenAddress,
          hash,
          nonce,
        });
        nonce++;
      } catch (err) {
        log("warn", "auto_buyer_token_approve_failed", {
          token: position.tokenAddress,
          nonce,
          error: errMessage(err),
        });
        // Skip this position for the tick — without an allowance the
        // sell would revert on `transferFrom`. Try again next tick.
        continue;
      }
    }

    try {
      const hash = await wallet.writeContract({
        address: CONTRACT_ADDRESSES.zap as `0x${string}`,
        abi: ZapAbi,
        functionName: "sell",
        args: [position.tokenAddress, balance, 0n],
        nonce,
      });
      log("info", "auto_buyer_sell_submitted", {
        token: position.tokenAddress,
        hash,
        nonce,
        balance: balance.toString(),
      });
      submitted++;
      nonce++;
    } catch (err) {
      // Common causes: LT redeem buffer depleted (BounceTech
      // replenishes ~10s; retry next tick), HyperSwap pair has too
      // little liquidity for the sell to clear `MIN_USDC_AMOUNT`
      // post-fee, dust position whose USD value rounds below the
      // floor. All transient or self-correcting.
      log("warn", "auto_buyer_sell_failed", {
        token: position.tokenAddress,
        nonce,
        error: errMessage(err),
      });
    }
  }

  return nonce;
}

/**
 * Tolerate `0x`-prefixed and bare hex secrets indistinguishably. Some
 * deployment tools strip the prefix on copy/paste; viem's
 * `privateKeyToAccount` requires the prefix and throws an opaque error
 * without it. Normalising once at the boundary keeps the downstream
 * call sites simple and the same-wallet guard's `privateKeyToAccount`
 * call symmetric with the auto-buyer's own.
 */
function normalizePrivateKey(raw: string): `0x${string}` {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
