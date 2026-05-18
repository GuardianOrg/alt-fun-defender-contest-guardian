import { BondingAbi, FactoryAbi, LeveragedTokenAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";

import { getWebSocketClient } from "./websocket";
import { FEES } from "../config/constants";
import { UniswapV2FactoryAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

/**
 * Bonding curve `Pair.getReserves()` returns `(uint256, uint256)` — no
 * `blockTimestampLast` (cf. `packages/contracts/src/Pair.sol`). HyperSwap
 * V2 returns `(uint112, uint112, uint32)`. viem decodes outputs strictly,
 * so we keep distinct ABIs for the two venues to avoid decode errors.
 */
const CurvePairAbi = [
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint256" },
      { name: "reserve1", type: "uint256" },
    ],
  },
  {
    name: "k",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tokenBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const HyperswapPairAbi = [
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

// Router-level USDC fee applied to every trade (curve and post-grad). The
// `Zap` charges this same 0.75% on both paths and forwards it to
// `FeeVault`, so quotes don't need to special-case graduated tokens — the
// fee math here mirrors the on-chain deduction regardless of execution venue.
//
// HyperSwap V2 takes its own 0.3% on the LT-side input (post-grad path).
// Mirrored here so post-grad quotes match what `Zap._buyOnHyperswap` /
// `_sellOnHyperswap` actually receives back from the DEX.
const HYPERSWAP_FEE_BPS = 30; // 0.30% — UniswapV2-style "fee on input"
const BPS_DENOM = 10_000;

const HYPER_EVM_RPC =
  import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// `batch: true` matches `config/wagmi.ts`. Quote pathways fan out 3–5
// independent `readContract` calls per quote (`getReserves`,
// `exchangeRate`, `k`, `tokenBalance`, `previewLtUntilGraduation`); with
// batching the same `Promise.all` lands as a single JSON-RPC batch
// instead of 3–5 separate HTTP POSTs.
const publicClient = createPublicClient({
  transport: http(HYPER_EVM_RPC, { batch: true }),
});

export type TransactionStep =
  | "idle"
  | "approving"
  | "signing"
  | "confirmed"
  | "error";
export type TxStep = TransactionStep | "executing";
/// `uploading` covers the multi-second OpenAI moderation + R2 write that
/// happens before any wallet popup. Without it the create-token button
/// would visibly look idle while the upload is in flight, and a
/// re-clicking user could fire a parallel `Zap.createToken` tx — the
/// second would land at the already-deployed CREATE2 clone address and
/// revert with `Clones.FailedDeployment()` (`0xb06ebf3d`). See
/// `useCreateToken.ts` for the matching busy-state + re-entry guard.
export type LaunchStep = TransactionStep | "uploading" | "deploying";

export interface BuyQuote {
  /**
   * Pre-formatted display string for the token amount the buyer receives.
   * Uses adaptive precision so sub-token amounts (small buys on
   * high-supply tokens) don't round to "0" the way a fixed
   * `maximumFractionDigits: 0` would.
   */
  tokensOut: string;
  /** Raw token amount the buyer receives (no formatting). Use when callers
   *  need to do arithmetic; UI surfaces should prefer `tokensOut`. */
  tokensOutRaw: number;
  curveFee: number;
  totalFee: number;
  priceImpactPct: number;
  youPay: number;
  youReceive: string;
  /**
   * USDC the curve will actually consume. Equals `youPay` for normal buys;
   * smaller when the buy crosses graduation and the on-chain `Router.buy`
   * caps consumption at remaining real supply. The unconsumed remainder is
   * refunded by `Zap._executeBuy` (see issue #12).
   */
  usdcUsed: number;
  /** True when the curve cap binds (graduating buy). */
  capped: boolean;
}

export interface SellQuote {
  usdcOut: number;
  curveFee: number;
  ltRedemptionFee: number;
  totalFee: number;
  priceImpactPct: number;
  youReceive: number;
  /**
   * Max token amount safely sellable right now given the LT's idle USDC
   * buffer, discounted by the user's slippage tolerance to leave headroom
   * for `exchangeRate()` drift / concurrent redeems between quote and
   * inclusion. Posting this value (rather than the raw theoretical max)
   * dodges BounceTech `InsufficientBalance` reverts.
   */
  maxSellableTokens: number;
  /** Available idle USDC in the LT contract for atomic redeems (raw, undiscounted). */
  bufferUsdc: number;
  /** Whether the requested sell exceeds the slippage-discounted buffer. */
  exceedsBuffer: boolean;
}

export interface ITradeRouterService {
  getQuoteBuy(
    curveAddress: string,
    usdcAmount: number,
  ): Promise<BuyQuote | null>;
  /**
   * @param slippage Fractional slippage tolerance (e.g. `0.02` = 2%). Used as
   *   the safety headroom on the LT idle-buffer cap so `maxSellableTokens`
   *   stays redeemable even if `exchangeRate()` ticks up or another redeem
   *   lands ahead of the user's tx between quote and inclusion.
   */
  getQuoteSell(
    curveAddress: string,
    tokenAmount: number,
    slippage?: number,
    /**
     * LT leverage multiplier (2 / 3 / 5). Drives the BounceTech LT
     * redemption-fee component of the quote — the fee is `0.3% × notional`
     * where `notional = USD × leverage`, so we need the actual leverage
     * (not a hard-coded `2`) for 3x/5x tokens to display a faithful net.
     */
    leverage?: number,
  ): Promise<SellQuote | null>;
}

interface PairContext {
  /**
   * Active AMM pair that holds `(token, lt)` reserves we should price
   * against. Curve phase: bonding curve pair from `Factory.pairFor`.
   * Post-graduation: HyperSwap V2 pair (`Zap` routes trades there). Quoting
   * the wrong pair returns garbage (the bonding pair's LT reserve drains
   * to zero on graduation), so this resolution must be graduation-aware.
   */
  pairAddress: `0x${string}`;
  ltAddress: `0x${string}`;
  graduated: boolean;
  /**
   * `true` when the HyperSwap pair sorts the token as `token0`. UniswapV2
   * pairs sort token addresses ascending at creation, so this flips the
   * `(reserve0, reserve1)` → `(tokenReserve, ltReserve)` mapping the
   * caller uses. Curve pairs always have token = reserve0 (Bonding mints
   * with `(token, lt)` order), so this is fixed `true` on the curve.
   */
  tokenIsToken0: boolean;
}

async function getPairContext(
  tokenAddress: `0x${string}`,
): Promise<PairContext> {
  const [bondingPair, ltAddress, graduated] = await Promise.all([
    publicClient.readContract({
      address: ADDRESSES.factory,
      abi: FactoryAbi,
      functionName: "pairFor",
      args: [tokenAddress],
    }) as Promise<`0x${string}`>,
    publicClient.readContract({
      address: ADDRESSES.factory,
      abi: FactoryAbi,
      functionName: "ltFor",
      args: [tokenAddress],
    }) as Promise<`0x${string}`>,
    publicClient.readContract({
      address: ADDRESSES.bonding,
      abi: BondingAbi,
      functionName: "isGraduated",
      args: [tokenAddress],
    }) as Promise<boolean>,
  ]);

  if (!graduated) {
    return {
      pairAddress: bondingPair,
      ltAddress,
      graduated: false,
      tokenIsToken0: true,
    };
  }

  const hyperswapPair = (await publicClient.readContract({
    address: ADDRESSES.hyperswapFactory,
    abi: UniswapV2FactoryAbi,
    functionName: "getPair",
    args: [tokenAddress, ltAddress],
  })) as `0x${string}`;

  // Defensive guard. `Bonding._seedHyperswap` creates and seeds the pair
  // atomically with the graduation flag flip, so a graduated token *should*
  // always have a pair. But if the HyperSwap factory address is stale (e.g.
  // pointed at the wrong chain on a fork/devnet) `getPair` silently returns
  // the zero address — calling `getReserves` on `0x000…000` then fails
  // deep inside viem with an opaque "method not found"/revert and the
  // caller's catch swallows it as a null quote with no diagnostic signal.
  // Throw a descriptive error so the failure is at least visible in the
  // console; the outer try/catch in `getQuoteBuy` / `getQuoteSell` still
  // collapses it to `null` for the UI ("no estimate"), but a developer
  // looking at the network tab will see the real cause.
  if (hyperswapPair === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      `HyperSwap pair missing for graduated token ${tokenAddress} ` +
        `(factory=${ADDRESSES.hyperswapFactory}, lt=${ltAddress}). ` +
        `Check HYPERSWAP_ADDRESSES.factory matches the active chain.`,
    );
  }

  // V2 sorts pair tokens by ascending address at creation time (cf.
  // `IUniswapV2Library.sortTokens`); cache the comparison so callers can
  // map reserves without re-fetching `token0()`.
  const tokenIsToken0 = tokenAddress.toLowerCase() < ltAddress.toLowerCase();

  return {
    pairAddress: hyperswapPair,
    ltAddress,
    graduated: true,
    tokenIsToken0,
  };
}

/**
 * Pre-graduation TTL for cached `PairContext` promises. Bonding-curve tokens
 * theoretically only flip `isGraduated` once — when `Bonding.finalizeGraduation`
 * lands on-chain — and the WS graduation channel evicts the affected token
 * synchronously when that happens. The TTL is the safety net for the cases
 * the WS path can't cover: tab was offline, packet was dropped between the
 * indexer DO and this client, the API edge cache returned a stale shard,
 * or the user's network just hiccuped at the wrong instant. 60s is well
 * inside the freshness budget any quote consumer cares about (the panel
 * itself re-quotes at WS cadence, ~1s) but bounds worst-case "missed
 * graduation" recovery so the panel can't get permanently stuck pricing
 * against an empty curve pair after the LT reserve has drained into
 * HyperSwap. Post-grad entries skip the timer entirely — `isGraduated`
 * is a one-way flag, so once we've cached `graduated: true` no further
 * lifecycle change can invalidate the resolved `(pairAddress, ltAddress,
 * tokenIsToken0)` triple.
 */
const PAIR_CONTEXT_PRE_GRAD_TTL_MS = 60_000;

/**
 * Per-token cache for `getPairContext`. The three reads it performs —
 * `Factory.pairFor`, `Factory.ltFor`, `Bonding.isGraduated` (plus the
 * post-grad `HyperswapFactory.getPair`) — return values that are
 * effectively immutable across a token's life, with one exception: the
 * graduation flip. By memoising the promise per address we avoid issuing
 * the same RPC trio on every `getQuoteBuy` / `getQuoteSell`, which the
 * trade panel calls on every keystroke (debounced) and on every `trade` /
 * `price` WS tick (~1Hz). Concretely this cuts a buy quote from 8 → 5
 * eth_calls and a sell from 6 → 3 — the largest single line item in the
 * client's RPC budget.
 *
 * Storing the in-flight `Promise` (rather than the resolved `PairContext`)
 * also dedupes concurrent callers: e.g. RightPanel's "GRADUATING SOON"
 * prefetch and TradePanel's quote on the same token now share one set of
 * reads instead of racing two parallel triples.
 */
const pairContextCache = new Map<string, Promise<PairContext>>();
let graduationFeedInstalled = false;

/**
 * Lazily subscribe to the global `graduation` WS channel so phase-2
 * graduations evict their cached pair context. Wildcard subscription
 * (no `token` param) attaches to the API's `graduation:__all__` shard,
 * which `broadcastToChannel` fans every per-token graduation event into
 * (cf. `apps/api/src/lib/broadcast.ts`). One subscription covers every
 * token in the catalogue — graduations are rare (a handful per peak
 * day), so the bandwidth cost is negligible compared to the quote-RPC
 * savings.
 *
 * Lazy install (rather than module-load) keeps the import side-effect
 * free for tests and SSR contexts that import this module without ever
 * quoting a trade. The first cache lookup wires up the listener; once
 * installed it stays for the app's lifetime (no unsub path — there's
 * no scenario in which we'd want to stop receiving graduation evicts).
 */
function installGraduationFeedOnce(): void {
  if (graduationFeedInstalled) return;
  graduationFeedInstalled = true;
  const ws = getWebSocketClient();
  if (!ws) return; // dev/preview without VITE_WS_URL — TTL alone covers us.

  ws.subscribe("graduation", (data) => {
    if (data === null || typeof data !== "object") return;
    const raw = data as { phase?: string; tokenAddress?: string };
    // Phase 1 ("graduating") fires inline on the threshold-crossing buy
    // but `Bonding.isGraduated` stays `false` — trades remain on the
    // curve until `finalizeGraduation` lands. Evicting on phase 1 would
    // force a useless re-resolve that returns the same pre-grad context.
    // Phase 2 ("graduated") is the actual flip we care about: HyperSwap
    // pair has been seeded, `isGraduated` is now `true`, and the next
    // quote needs the post-grad context.
    if (raw.phase !== "graduated") return;
    if (typeof raw.tokenAddress !== "string") return;
    pairContextCache.delete(raw.tokenAddress.toLowerCase());
  });
}

function getPairContextCached(
  tokenAddress: `0x${string}`,
): Promise<PairContext> {
  installGraduationFeedOnce();
  const key = tokenAddress.toLowerCase();
  const hit = pairContextCache.get(key);
  if (hit) return hit;

  const promise = getPairContext(tokenAddress);
  pairContextCache.set(key, promise);

  // Identity-checked eviction in both branches below: a graduation
  // event during the in-flight resolve would `delete(key)` and a
  // subsequent caller would re-populate the slot with a fresh promise.
  // Guarding on `cache.get(key) === promise` ensures the original
  // promise's settlement can only ever evict ITSELF — never a younger
  // entry that happens to share the same key.
  promise.then(
    (ctx) => {
      if (!ctx.graduated) {
        setTimeout(() => {
          if (pairContextCache.get(key) === promise) {
            pairContextCache.delete(key);
          }
        }, PAIR_CONTEXT_PRE_GRAD_TTL_MS);
      }
      // Post-grad: cache forever (one-way flag, immutable triple).
    },
    () => {
      // Failed resolve (RPC outage, missing HyperSwap pair, malformed
      // factory address). Evict immediately so a transient outage
      // doesn't poison the cache for the full TTL window — the next
      // quote retries from scratch with fresh reads.
      if (pairContextCache.get(key) === promise) {
        pairContextCache.delete(key);
      }
    },
  );

  return promise;
}

const liveTradeRouter: ITradeRouterService = {
  async getQuoteBuy(curveAddress, usdcAmount) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress, graduated, tokenIsToken0 } =
        await getPairContextCached(tokenAddr);

      // Curve path also needs `k` and `tokenBalance` so we can run
      // `Router._computeBuy`'s xy=k math entirely in JS (see below). On the
      // graduated/HyperSwap path the swap formula is the standard V2 one
      // and we don't have a `k()` getter to read, so we just fetch
      // reserves + exchangeRate. Curve path additionally pulls
      // `Bonding.previewLtUntilGraduation` for the graduation cap so the
      // quote stays in lock-step with `Zap._executeBuy`'s pre-sizing
      // (which now bounds buys at the smallest LT amount that flips
      // `canGraduate(token)` to true — supply or USD trigger, whichever
      // fires first). Without this the FE would over-quote tokens on a
      // buy that crosses the threshold.
      const [
        reserves,
        exchangeRate,
        kRaw,
        tokenBalanceRaw,
        ltUntilGraduationRaw,
      ] = await Promise.all([
        graduated
          ? (publicClient.readContract({
              address: pairAddress,
              abi: HyperswapPairAbi,
              functionName: "getReserves",
            }) as Promise<readonly [bigint, bigint, number]>)
          : (publicClient.readContract({
              address: pairAddress,
              abi: CurvePairAbi,
              functionName: "getReserves",
            }) as Promise<readonly [bigint, bigint]>),
        publicClient.readContract({
          address: ltAddress,
          abi: LeveragedTokenAbi,
          functionName: "exchangeRate",
        }) as Promise<bigint>,
        graduated
          ? Promise.resolve(0n)
          : (publicClient.readContract({
              address: pairAddress,
              abi: CurvePairAbi,
              functionName: "k",
            }) as Promise<bigint>),
        graduated
          ? Promise.resolve(0n)
          : (publicClient.readContract({
              address: pairAddress,
              abi: CurvePairAbi,
              functionName: "tokenBalance",
            }) as Promise<bigint>),
        graduated
          ? Promise.resolve(0n)
          : (publicClient.readContract({
              address: ADDRESSES.bonding,
              abi: BondingAbi,
              functionName: "previewLtUntilGraduation",
              args: [tokenAddr],
            }) as Promise<bigint>),
      ]);

      const [reserve0, reserve1] = reserves;
      const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
      const ltReserve = tokenIsToken0 ? reserve1 : reserve0;

      const exRate = parseFloat(formatUnits(exchangeRate, 18));
      const ltReserveFloat = parseFloat(formatUnits(ltReserve, 18));
      const tokenReserveFloat = parseFloat(formatUnits(tokenReserve, 18));

      // Defensive guard. A degraded LT (`exchangeRate()` returning 0) would
      // produce `Infinity` for `ltIn` below, then `parseUnits("Infinity")`
      // throws and the outer catch silently returns null — leaving the UI
      // stuck on "you receive …". Surface it instead.
      if (!Number.isFinite(exRate) || exRate <= 0) {
        throw new Error(
          `LT ${ltAddress} returned non-positive exchangeRate (${exchangeRate}). ` +
            `Cannot quote buy.`,
        );
      }

      const curveFee = usdcAmount * FEES.curveBuy;
      const netUsdc = usdcAmount - curveFee;
      const ltIn = netUsdc / exRate;

      let tokensOut: number;
      let usdcUsed = netUsdc;
      let capped = false;

      if (graduated) {
        // Post-grad: HyperSwap V2 0.30% fee on input.
        const effectiveLtIn =
          (ltIn * (BPS_DENOM - HYPERSWAP_FEE_BPS)) / BPS_DENOM;
        tokensOut =
          ltReserveFloat > 0
            ? (tokenReserveFloat * effectiveLtIn) /
              (ltReserveFloat + effectiveLtIn)
            : 0;
      } else {
        // Curve path: replicate `Router._computeBuy` in BigInt so we don't
        // depend on `Router.previewBuy` being callable. Mirroring the math
        // (rather than calling the on-chain view) eliminates a class of
        // silent quote failures we were seeing where the on-chain call
        // reverted/returned malformed data and the outer try/catch
        // collapsed it to a null quote ("you receive …").
        //
        //   amountInUsed   = ltInWei
        //   newAssetRes    = ltReserve + amountInUsed
        //   tokensOutWei   = tokenReserve − (k / newAssetRes)
        //   if (tokensOutWei > tokenBalance) {
        //     tokensOutWei      = tokenBalance     (overflow cap)
        //     cappedTokenRes    = tokenReserve − tokensOutWei
        //     cappedAssetRes    = ceilDiv(k, cappedTokenRes)
        //     amountInUsed      = cappedAssetRes − ltReserve
        //   }
        //
        // Use a Number→BigInt path with a fixed 18-decimal scale via
        // `parseUnits`. `Number(ltIn).toFixed(18)` ≈ 16 sig figs is fine
        // for the magnitudes we deal with (LT amounts < 1e9 tokens).
        if (kRaw === 0n) {
          throw new Error(
            `Curve pair ${pairAddress} has k=0 (uninitialised). ` +
              `Cannot quote buy.`,
          );
        }

        // Apply the graduation cap first: trim the LT input down to
        // `ltUntilGraduation` if the buy would otherwise cross either
        // trigger of `canGraduate`. `Zap._executeBuy` does the same
        // pre-sizing on-chain via `Bonding.previewLtUntilGraduation`,
        // so quoting the un-capped K math here would over-state
        // tokens-out on every graduating buy. A zero cap means the
        // token is already graduatable (LT appreciation pushed it past
        // the USD trigger between buys) — the on-chain floor-bump
        // still lands a `MIN_USDC_AMOUNT` mint and graduates the token,
        // but the quote is honest about how little of that the buyer
        // captures.
        const ltInWei = parseUnits(ltIn.toFixed(18), 18);
        const cappedLtInWei =
          ltUntilGraduationRaw > 0n && ltInWei > ltUntilGraduationRaw
            ? ltUntilGraduationRaw
            : ltUntilGraduationRaw === 0n
              ? 0n
              : ltInWei;
        const newAssetReserveWei = ltReserve + cappedLtInWei;
        let tokensOutWei =
          newAssetReserveWei === 0n
            ? 0n
            : tokenReserve - kRaw / newAssetReserveWei;
        let amountInUsedWei = cappedLtInWei;

        if (tokensOutWei > tokenBalanceRaw) {
          tokensOutWei = tokenBalanceRaw;
          const cappedTokenReserve = tokenReserve - tokensOutWei;
          if (cappedTokenReserve === 0n) {
            throw new Error("Overflow cap degenerate (cappedTokenReserve=0)");
          }
          // Solidity `(k + cappedTokenReserve - 1) / cappedTokenReserve`
          const cappedAssetReserve =
            (kRaw + cappedTokenReserve - 1n) / cappedTokenReserve;
          amountInUsedWei = cappedAssetReserve - ltReserve;
        }

        tokensOut = parseFloat(formatUnits(tokensOutWei, 18));
        const ltUsed = parseFloat(formatUnits(amountInUsedWei, 18));
        capped = amountInUsedWei < ltInWei;
        if (capped) usdcUsed = ltUsed * exRate;
      }

      const priceImpact =
        ltReserveFloat > 0 ? (ltIn / ltReserveFloat) * 100 : 0;

      // Cap-binding curve buys: `usdcUsed` is the *net* (post-fee) USDC the
      // curve consumed. The on-chain fee is charged against the matching
      // gross — `Zap._executeBuy` ratios `feeOnGross` by `baseToConvert /
      // netUsdc`, equivalent to `actualFee = grossConsumed - usdcUsed`
      // where `grossConsumed = usdcUsed / (1 - bps)`. Computing the fee as
      // `usdcUsed * bps` would understate it (fee on net, not gross).
      const grossConsumed = capped
        ? usdcUsed / (1 - FEES.curveBuy)
        : usdcAmount;
      const cappedCurveFee = capped ? grossConsumed - usdcUsed : curveFee;

      // Adaptive precision: small buys on high-supply tokens can produce
      // sub-1 token outputs that would round to "0" with a fixed
      // `maximumFractionDigits: 0`. Show 4dp under 1 token, 2dp under 100,
      // 0dp at scale (where commas + integer rounding read cleanly).
      const fractionDigits =
        tokensOut === 0 ? 0 : tokensOut < 1 ? 4 : tokensOut < 100 ? 2 : 0;
      const tokensOutFormatted = tokensOut.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: 0,
      });

      return {
        tokensOut: tokensOutFormatted,
        tokensOutRaw: tokensOut,
        curveFee: cappedCurveFee,
        totalFee: cappedCurveFee,
        priceImpactPct: parseFloat(priceImpact.toFixed(2)),
        youPay: grossConsumed,
        youReceive: `${(tokensOut / 1e6).toFixed(1)}M`,
        usdcUsed,
        capped,
      };
    } catch (err) {
      // Without this log a misconfigured RPC / missing pair / degraded LT
      // shows up to the user as "you receive …" with no diagnostic in the
      // network tab. Keep the `return null` so the UI handles "no quote"
      // gracefully, but make the cause findable in console.
      console.error("getQuoteBuy failed:", err);
      return null;
    }
  },

  async getQuoteSell(curveAddress, tokenAmount, slippage = 0, leverage = 2) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress, graduated, tokenIsToken0 } =
        await getPairContextCached(tokenAddr);

      const [reserves, exchangeRate, baseAssetBal] = await Promise.all([
        graduated
          ? (publicClient.readContract({
              address: pairAddress,
              abi: HyperswapPairAbi,
              functionName: "getReserves",
            }) as Promise<readonly [bigint, bigint, number]>)
          : (publicClient.readContract({
              address: pairAddress,
              abi: CurvePairAbi,
              functionName: "getReserves",
            }) as Promise<readonly [bigint, bigint]>),
        publicClient.readContract({
          address: ltAddress,
          abi: LeveragedTokenAbi,
          functionName: "exchangeRate",
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ltAddress,
          abi: LeveragedTokenAbi,
          functionName: "baseAssetBalance",
        }) as Promise<bigint>,
      ]);

      const [reserve0, reserve1] = reserves;
      const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
      const ltReserve = tokenIsToken0 ? reserve1 : reserve0;

      const exRate = parseFloat(formatUnits(exchangeRate, 18));
      const ltReserveFloat = parseFloat(formatUnits(ltReserve, 18));
      const tokenReserveFloat = parseFloat(formatUnits(tokenReserve, 18));
      const bufferUsdc = parseFloat(formatUnits(baseAssetBal, 6));

      // V2 0.30% fee taken on input (token side here for sells).
      const effectiveTokenIn = graduated
        ? (tokenAmount * (BPS_DENOM - HYPERSWAP_FEE_BPS)) / BPS_DENOM
        : tokenAmount;
      const ltOut =
        tokenReserveFloat > 0
          ? (ltReserveFloat * effectiveTokenIn) /
            (tokenReserveFloat + effectiveTokenIn)
          : 0;
      const grossUsdc = ltOut * exRate;
      const curveFee = grossUsdc * FEES.curveSell;
      // BounceTech `redeem()` charges `0.3% × notional`, where notional =
      // `USD × leverage`. Previously the leverage factor was hard-coded to
      // `2`, which under-quoted 3x/5x tokens by 0.9% / 1.5% of grossUsdc —
      // the displayed "you receive" was higher than what actually landed
      // post-redeem. Fall back to `2` only when the caller didn't pass a
      // leverage (legacy callers / mocks) so the old behaviour is preserved.
      const ltRedemptionFee = grossUsdc * FEES.ltRedemption * leverage;
      const totalFee = curveFee + ltRedemptionFee;
      const netUsdc = grossUsdc - totalFee;
      const priceImpact =
        tokenReserveFloat > 0 ? (tokenAmount / tokenReserveFloat) * 100 : 0;

      // Apply the user's slippage tolerance as headroom on the LT idle buffer.
      // The on-chain `redeem()` consumes USDC from `baseAssetBalance()` at the
      // *executed* `exchangeRate()`, not the quoted one — if the rate ticks up
      // (or another redeem lands first) between quote and inclusion, the same
      // LT amount needs more USDC than we sized it for and the tx reverts with
      // BounceTech's `InsufficientBalance`. Sizing against `bufferUsdc *
      // (1 - slippage)` reuses the same tolerance the user set for price
      // protection, so the cap moves with their risk preference rather than a
      // hard-coded magic number.
      const safetyFactor = Math.max(0, Math.min(1, 1 - slippage));
      const safeBufferUsdc = bufferUsdc * safetyFactor;
      const bufferLt = exRate > 0 ? safeBufferUsdc / exRate : 0;
      const bufferBinds = bufferLt > 0 && ltReserveFloat > bufferLt;
      const maxSellableTokens = bufferBinds
        ? (tokenReserveFloat * bufferLt) / (ltReserveFloat - bufferLt)
        : Infinity;
      const safeMaxSellable = Number.isFinite(maxSellableTokens)
        ? Math.max(0, maxSellableTokens)
        : Infinity;

      const redeemUsdc = grossUsdc - curveFee;
      const exceedsBuffer = redeemUsdc > safeBufferUsdc;

      return {
        usdcOut: netUsdc,
        curveFee,
        ltRedemptionFee,
        totalFee,
        priceImpactPct: parseFloat(priceImpact.toFixed(2)),
        youReceive: netUsdc,
        maxSellableTokens: safeMaxSellable,
        bufferUsdc,
        exceedsBuffer,
      };
    } catch {
      return null;
    }
  },
};

export const tradeRouterService: ITradeRouterService = liveTradeRouter;
