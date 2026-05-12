/**
 * Auto-buy keeper. Runs on the API Worker's `scheduled()` cron tick and
 * triggers phase 1 of graduation for tokens that have been pushed past
 * the USD threshold by LT price appreciation alone (i.e. without a buy
 * since the LT rallied).
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
 * size, which can be hours or days. This keeper closes that gap by
 * placing the smallest possible Zap buy — pure mechanical trigger,
 * no economic position taken — and then unwinds the resulting token
 * holding back to USDC the moment phase 2 finalises (or back through
 * the curve if the buy somehow didn't actually trigger graduation).
 *
 * Two phases per cron tick
 * ------------------------
 * 1. **Buy phase.** Sweep curve-phase tokens, filter to those where
 *    `Bonding.canGraduate(token) == true`, fire one minimum-size
 *    `Zap.buy` per match. Any buy of any size when `canGraduate` is
 *    already true will trigger phase 1 — the buy adds LT to the
 *    reserve, so the post-buy USD value is strictly larger than the
 *    pre-buy value that already passed the threshold (assuming the LT
 *    rate doesn't whipsaw between our `canGraduate` read and the buy
 *    landing — which is rare and self-healing: any leftover position
 *    is unwound by the sell phase).
 * 2. **Sell phase.** Sweep wallet positions accrued from past buys,
 *    sell anything we still hold via `Zap.sell`. We can sell a Curve-
 *    phase position back to the curve and a Graduated-phase position
 *    against the HyperSwap pair — only `Graduating` blocks us (Zap
 *    reverts with `TokenIsGraduating`), and that's transient
 *    (~60s window driven by the existing finalize keeper).
 *
 * Wallet separation from the finalize keeper (intentional)
 * --------------------------------------------------------
 * The finalize keeper (`KEEPER_PRIVATE_KEY`) is on **big blocks** for
 * the ~2.5M-gas `Bonding.finalizeGraduation` call. This keeper must
 * stay on **small blocks** so its sub-second buys/sells aren't queued
 * behind the finalize keeper's ~60s big-block confirmations. Because
 * Hyperliquid L1's small/big-block toggle is sticky per-wallet, the
 * two keepers MUST be different wallets — never reuse keys. Setup
 * checklist for this wallet:
 *   1. Generate a fresh key — DO NOT reuse `KEEPER_PRIVATE_KEY` or
 *      the deployer key.
 *   2. Fund with HYPE for gas (each cycle is two ~120k-gas txs).
 *   3. Fund with USDC — sized for ~`MAX_BUYS_PER_TICK × TRIGGER_BUY_USDC`
 *      of in-flight capital plus a cushion for the brief window where
 *      tokens have been bought but not yet sold (until phase 2 lands).
 *   4. **Leave big blocks OFF** (default). If the wallet was ever
 *      toggled on, run
 *        `DEPLOYER_PRIVATE_KEY=<this key> node packages/contracts/scripts/toggle-big-blocks.mjs off`
 *      to flip back to small blocks before deploying the secret.
 *   5. `wrangler secret put AUTO_GRADUATION_BUYER_PRIVATE_KEY` for
 *      prod / preview.
 *
 * Idempotency / safety properties
 * --------------------------------
 *   - `Bonding.canGraduate` is the same view the contract uses to
 *     decide whether to enter `Graduating` post-buy, so a `true` reply
 *     here means the next buy *will* fire phase 1 (modulo LT rate
 *     drift between read and tx, see above).
 *   - `Zap.buy` reverts with `TokenIsGraduating` once the lifecycle
 *     has flipped, so a race against another buyer who beat us to the
 *     trigger is safely caught and logged — not a double-trigger.
 *   - `Zap.sell` reverts on `Graduating` lifecycle. Filter on the
 *     authoritative `Bonding.isGraduating` view so we only attempt
 *     sells in `Curve` or `Graduated`.
 *   - Per-tick caps (`MAX_BUYS_PER_TICK`, `MAX_SELLS_PER_TICK`) bound
 *     wall-clock per tick and capital exposure.
 *   - All txs use manually-managed sequential nonces, matching
 *     `graduation-keeper.ts` — viem's pending-nonce auto-fetch double-
 *     counts on rapid back-to-back submits.
 *   - USDC is approved to `Zap` once at `MAX_UINT256`; the per-tick
 *     allowance check is a no-op after the first tick. Per-token
 *     approvals for sells use the same one-time `MAX_UINT256` pattern.
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
  CONTRACT_ADDRESSES,
  HYPER_EVM,
  TokenAbi,
  USDC_ADDRESS,
  ZapAbi,
} from "@launchpad/shared";

import { createPonderQuery } from "./ponder-client.js";
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
 * Trigger buy size in USDC (6dp). Two floors interact here, and the
 * sell-side floor is the binding one — not the buy-side floor as the
 * earlier `$11` sizing assumed:
 *
 *   1. **Buy-side**: `Zap.MIN_USDC_AMOUNT` ($10) and the post-fee
 *      `netUsdc ≥ $10` check in `Zap._executeBuy`. A `$11` gross
 *      survives any `buyFeeBps ≤ Zap.MAX_FEE_BPS` (2%) skim, so the
 *      buy itself was never the constraint. This is the floor the
 *      original `$11` sizing was tuned against.
 *   2. **Sell-side (binding)**: `Zap._sellInternal` reverts with
 *      `BelowMinAmount` if `(ltReceived × exchangeRate) / 1e12 <
 *      MIN_USDC_AMOUNT` — i.e. the gross USDC the redemption would
 *      yield must be ≥ $10. The bot's roundtrip is buy → token →
 *      (graduation) → sell-back-to-USDC; if the LT exchange rate
 *      drifts down between the buy and the sell, the same LT
 *      quantity yields proportionally less USDC. With a `$11` gross
 *      buy (`$10.945` net of the 0.5% fee) the bot can only
 *      tolerate a `~9%` LT drawdown before the sell reverts and
 *      the position is stranded as undrainable dust.
 *
 * `$20` widens the LT-drift cushion to ~`50%` (`$19.90` net buy →
 * sell would only revert if the LT halved between phases). That's
 * comfortably above any realistic intra-cron LT move on the 2x/3x/5x
 * leveraged tokens we run against, with a meaningful margin even for
 * the 5x volatility profile during a market-wide flash crash. The
 * tradeoff is doubling the per-trigger capital exposure (`$11 → $20`
 * × `MAX_BUYS_PER_TICK = 5` → ~`$100` in flight), which is fine for a
 * pure mechanical trigger that the bot never wants as an economic
 * position. Stranded dust would be a worse outcome than slightly
 * higher in-flight capital, since the keeper has no recovery path
 * for sub-`$10` positions other than waiting for the LT to recover.
 *
 * Both floors are still cleared with comfortable margin under the
 * worst-case `Zap.MAX_FEE_BPS` (2%) so a future fee bump can't
 * quietly brick this keeper.
 */
const TRIGGER_BUY_USDC = 20_000_000n;

/**
 * Cap on `Zap.buy` submissions per cron tick. Each submission is
 * sub-second (no receipt wait), so even at the cap the buy phase
 * costs ~5s wall-clock — well inside the ~30s cron budget shared
 * with the other `scheduled()` jobs. A flood of newly-eligible
 * tokens (e.g. an LT spikes 50% in a minute and pushes 20 tokens
 * over their thresholds at once) drains across multiple ticks.
 */
const MAX_BUYS_PER_TICK = 5;

/**
 * Cap on `Zap.sell` submissions per cron tick. Sells are 2 txs each
 * (one-time `Token.approve` then `Zap.sell`) so the per-tick budget
 * is tighter than the buy phase. Stranded positions naturally drain
 * over subsequent ticks.
 */
const MAX_SELLS_PER_TICK = 5;

/**
 * Pre-filter pool size pulled from Ponder for the buy phase. We
 * multicall `canGraduate` against this set every tick to find
 * triggerable tokens. 500 is comfortably more than the live token
 * count today; if we ever outgrow it we should switch to a
 * `usdFilled`-keyed pre-filter rather than blindly raising the cap.
 */
const CURVE_TOKEN_FETCH_LIMIT = 500;

/**
 * Pre-filter pool size pulled from Ponder for the sell phase. The
 * keeper's wallet only ever holds positions it acquired itself, so
 * this caps how many positions we'll consider in one tick. 200 is
 * far more than `MAX_BUYS_PER_TICK × <ticks-until-finalize>` could
 * ever produce, leaving headroom for any backlog.
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

interface CurveToken {
  address: `0x${string}`;
}

interface WalletPosition {
  tokenAddress: `0x${string}`;
}

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

  // ─── Buy phase ─────────────────────────────────────────────────────
  nonce = await runBuyPhase(env, publicClient, wallet, account.address, nonce);

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

async function runBuyPhase(
  env: AppBindings,
  publicClient: PublicClientT,
  wallet: WalletClientT,
  bot: `0x${string}`,
  startNonce: number,
): Promise<number> {
  const candidates = await fetchCurveTokens(env.PONDER_URL);
  if (candidates === null) {
    log("warn", "auto_buyer_ponder_unreachable", { phase: "buy" });
    return startNonce;
  }
  if (candidates.length === 0) return startNonce;

  // Authoritative on-chain check. `Bonding.canGraduate` returns true
  // only when (a) the token exists, (b) lifecycle == Curve, AND (c)
  // either supply has sold out OR `realLT × exchangeRate ≥ threshold`.
  // (a) and (b) filter out anything that isn't a valid trigger target;
  // (c) is the actual signal.
  const canGraduateResults = await publicClient.multicall({
    multicallAddress: MULTICALL3_ADDRESS,
    allowFailure: true,
    contracts: candidates.map((t) => ({
      address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
      abi: CAN_GRADUATE_ABI,
      functionName: "canGraduate" as const,
      args: [t.address] as const,
    })),
  });

  const triggerable: `0x${string}`[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = canGraduateResults[i];
    if (r && r.status === "success" && r.result === true) {
      const candidate = candidates[i];
      if (candidate) triggerable.push(candidate.address);
    }
  }

  if (triggerable.length === 0) return startNonce;

  let nonce = startNonce;

  // One-time USDC approval to Zap. Allowance is read post-trigger so
  // we don't burn an RPC call on the common "nothing to do" path.
  // `MAX_UINT256` keeps subsequent ticks from re-spending gas on
  // approvals — USDC supports it (no `revert`-on-existing-allowance
  // quirks like the legacy USDT pattern).
  const usdcAllowance = (await publicClient.readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: "allowance",
    args: [bot, CONTRACT_ADDRESSES.zap as `0x${string}`],
  })) as bigint;

  if (
    usdcAllowance <
    TRIGGER_BUY_USDC * BigInt(MAX_BUYS_PER_TICK)
  ) {
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
        address: USDC_ADDRESS as `0x${string}`,
        abi: TokenAbi,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.zap as `0x${string}`, maxUint256],
        nonce,
      });
      log("info", "auto_buyer_usdc_approve_submitted", { hash, nonce });
      nonce++;
    } catch (err) {
      log("error", "auto_buyer_usdc_approve_failed", {
        nonce,
        error: errMessage(err),
      });
      // Approval is a precondition for the buys — abort the buy
      // phase and let the next tick retry. No nonce consumed.
      return nonce;
    }
  }

  let submitted = 0;
  for (const tokenAddr of triggerable) {
    if (submitted >= MAX_BUYS_PER_TICK) break;
    try {
      // See the USDC-approve writeContract above for the
      // omit-`account`-and-`chain` rationale.
      const hash = await wallet.writeContract({
        address: CONTRACT_ADDRESSES.zap as `0x${string}`,
        abi: ZapAbi,
        functionName: "buy",
        args: [
          tokenAddr,
          TRIGGER_BUY_USDC,
          0n,
          "0x0000000000000000000000000000000000000000",
        ],
        nonce,
      });
      log("info", "auto_buyer_buy_submitted", {
        token: tokenAddr,
        hash,
        nonce,
        usdcAmount: TRIGGER_BUY_USDC.toString(),
      });
      submitted++;
      nonce++;
    } catch (err) {
      // Most likely cause: race with a real user buy that landed first
      // and flipped lifecycle to `Graduating` (Zap reverts with
      // `TokenIsGraduating`). Other causes: LT mint paused, USDC
      // balance exhausted, nonce drift from the cron lapping itself.
      // All recoverable next tick. No local nonce consumed (submission
      // never broadcast).
      log("warn", "auto_buyer_buy_failed", {
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
  const positions = await fetchWalletPositions(env.PONDER_URL, bot);
  if (positions === null) {
    log("warn", "auto_buyer_ponder_unreachable", { phase: "sell" });
    return startNonce;
  }
  if (positions.length === 0) return startNonce;

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

async function fetchCurveTokens(
  ponderUrl: string | undefined,
): Promise<CurveToken[] | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{
    tokens: { items: CurveToken[] };
  }>(
    `query {
      tokens(
        where: { graduated: false, pendingGraduation: false }
        limit: ${CURVE_TOKEN_FETCH_LIMIT}
        orderBy: "ltReserve"
        orderDirection: "desc"
      ) {
        items {
          address
        }
      }
    }`,
  );
  if (data === null) return null;
  return data.tokens.items;
}

async function fetchWalletPositions(
  ponderUrl: string | undefined,
  bot: `0x${string}`,
): Promise<WalletPosition[] | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  // Ponder lower-cases hex addresses internally; the keeper's
  // `account.address` is checksum-cased. Normalise here so the WHERE
  // clause matches even if viem swaps the casing convention later.
  const data = await queryPonder<{
    walletPositions: { items: WalletPosition[] };
  }>(
    `query Positions($wallet: String!) {
      walletPositions(
        where: { wallet: $wallet, zapTokenAmount_gt: "0" }
        limit: ${POSITION_FETCH_LIMIT}
      ) {
        items {
          tokenAddress
        }
      }
    }`,
    { wallet: bot.toLowerCase() },
  );
  if (data === null) return null;
  return data.walletPositions.items;
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
