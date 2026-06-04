import { BondingAbi, FactoryAbi, LeveragedTokenAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";

import { getWebSocketClient } from "./websocket";
import { FEES } from "../config/constants";
import { UniswapV2FactoryAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

// Curve and HyperSwap pairs return different `getReserves()` shapes.
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

// Zap charges its 0.75% on curve and post-grad; HyperSwap adds 0.3% post-grad.
const HYPERSWAP_FEE_BPS = 30; // 0.30% — UniswapV2-style "fee on input"
const BPS_DENOM = 10_000;

const HYPER_EVM_RPC =
  import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// Quote paths fan out several reads; batch them into one JSON-RPC POST.
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
// Includes pre-wallet image moderation/upload and on-chain deployment states.
export type LaunchStep = TransactionStep | "uploading" | "deploying";

export interface BuyQuote {
  /** Display string with adaptive precision for small buys. */
  tokensOut: string;
  /** Raw token amount the buyer receives. */
  tokensOutRaw: number;
  curveFee: number;
  totalFee: number;
  priceImpactPct: number;
  youPay: number;
  youReceive: string;
  /** USDC actually consumed; smaller than `youPay` when a graduating buy is capped. */
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
  /** Max safely sellable now after discounting the LT idle-USDC buffer by slippage. */
  maxSellableTokens: number;
  /** Available idle USDC in the LT contract for atomic redeems (raw, undiscounted). */
  bufferUsdc: number;
  /** Whether the requested sell exceeds the slippage-discounted buffer. */
  exceedsBuffer: boolean;
}

/** Optional API/WS values that skip per-quote LT RPC reads when available. */
export interface LtLiveOverrides {
  exchangeRateWei?: bigint;
  baseAssetBalanceWei?: bigint;
}

export interface ITradeRouterService {
  getQuoteBuy(
    curveAddress: string,
    usdcAmount: number,
    overrides?: LtLiveOverrides,
  ): Promise<BuyQuote | null>;
  /** @param slippage Fractional tolerance used as LT idle-buffer headroom. */
  getQuoteSell(
    curveAddress: string,
    tokenAmount: number,
    slippage?: number,
    /** LT leverage multiplier for BounceTech redemption-fee display. */
    leverage?: number,
    overrides?: LtLiveOverrides,
  ): Promise<SellQuote | null>;
}

interface PairContext {
  /** Active AMM pair to price against: bonding curve before grad, HyperSwap after. */
  pairAddress: `0x${string}`;
  ltAddress: `0x${string}`;
  graduated: boolean;
  /** Whether reserve0 maps to token instead of LT. */
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

  // Throw clearly if config points at a factory that lacks the graduated pair.
  // collapses it to `null` for the UI ("no estimate"), but a developer
  // looking at the network tab will see the real cause.
  if (hyperswapPair === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      `HyperSwap pair missing for graduated token ${tokenAddress} ` +
        `(factory=${ADDRESSES.hyperswapFactory}, lt=${ltAddress}). ` +
        `Check HYPERSWAP_ADDRESSES.factory matches the active chain.`,
    );
  }

  // V2 sorts pair tokens by ascending address at creation.
  const tokenIsToken0 = tokenAddress.toLowerCase() < ltAddress.toLowerCase();

  return {
    pairAddress: hyperswapPair,
    ltAddress,
    graduated: true,
    tokenIsToken0,
  };
}

// Safety net for missed graduation WS evictions; post-grad contexts cache forever.
const PAIR_CONTEXT_PRE_GRAD_TTL_MS = 60_000;

// Per-token promise cache for pair/venue context; graduation is the only invalidator.
const pairContextCache = new Map<string, Promise<PairContext>>();
let graduationFeedInstalled = false;

/** Lazily subscribe to phase-2 graduations and evict cached pair context. */
function installGraduationFeedOnce(): void {
  if (graduationFeedInstalled) return;
  graduationFeedInstalled = true;
  const ws = getWebSocketClient();
  if (!ws) return; // dev/preview without VITE_WS_URL — TTL alone covers us.

  ws.subscribe("graduation", (data) => {
    if (data === null || typeof data !== "object") return;
    const raw = data as { phase?: string; tokenAddress?: string };
    // Phase 2 is when the HyperSwap pair exists and quotes must switch venues.
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

  // Settlement can only evict its own promise, not a younger replacement.
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
      // Transient resolve failures should not poison the cache.
      if (pairContextCache.get(key) === promise) {
        pairContextCache.delete(key);
      }
    },
  );

  return promise;
}

const liveTradeRouter: ITradeRouterService = {
  async getQuoteBuy(curveAddress, usdcAmount, overrides) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress, graduated, tokenIsToken0 } =
        await getPairContextCached(tokenAddr);

      // Curve quotes need xy=k fields and graduation cap; post-grad uses V2 reserves.
      // Exchange-rate overrides skip redundant LT RPC reads when live data is available.
      const exchangeRatePromise =
        overrides?.exchangeRateWei !== undefined
          ? Promise.resolve(overrides.exchangeRateWei)
          : (publicClient.readContract({
              address: ltAddress,
              abi: LeveragedTokenAbi,
              functionName: "exchangeRate",
            }) as Promise<bigint>);

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
        exchangeRatePromise,
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

      // Surface degraded LT rates before they become `Infinity` quote math.
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
        // Mirror `Router._computeBuy` locally so quote failures stay diagnosable.
        if (kRaw === 0n) {
          throw new Error(
            `Curve pair ${pairAddress} has k=0 (uninitialised). ` +
              `Cannot quote buy.`,
          );
        }

        // Match Zap's graduation pre-sizing so crossing buys don't over-quote.
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

      // Cap-binding buys charge fee on matching gross, not on net `usdcUsed`.
      const grossConsumed = capped
        ? usdcUsed / (1 - FEES.curveBuy)
        : usdcAmount;
      const cappedCurveFee = capped ? grossConsumed - usdcUsed : curveFee;

      // Avoid rendering tiny token outputs as "0".
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
      // Keep UI graceful but make quote failures findable in console.
      console.error("getQuoteBuy failed:", err);
      return null;
    }
  },

  async getQuoteSell(
    curveAddress,
    tokenAmount,
    slippage = 0,
    leverage = 2,
    overrides,
  ) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress, graduated, tokenIsToken0 } =
        await getPairContextCached(tokenAddr);

      // Overrides skip redundant LT RPC reads; slippage buffers idle-USDC drift.
      const exchangeRatePromise =
        overrides?.exchangeRateWei !== undefined
          ? Promise.resolve(overrides.exchangeRateWei)
          : (publicClient.readContract({
              address: ltAddress,
              abi: LeveragedTokenAbi,
              functionName: "exchangeRate",
            }) as Promise<bigint>);
      const baseAssetBalPromise =
        overrides?.baseAssetBalanceWei !== undefined
          ? Promise.resolve(overrides.baseAssetBalanceWei)
          : (publicClient.readContract({
              address: ltAddress,
              abi: LeveragedTokenAbi,
              functionName: "baseAssetBalance",
            }) as Promise<bigint>);

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
        exchangeRatePromise,
        baseAssetBalPromise,
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
      // BounceTech redemption fee is on notional (`USD × leverage`).
      const ltRedemptionFee = grossUsdc * FEES.ltRedemption * leverage;
      const totalFee = curveFee + ltRedemptionFee;
      const netUsdc = grossUsdc - totalFee;
      const priceImpact =
        tokenReserveFloat > 0 ? (tokenAmount / tokenReserveFloat) * 100 : 0;

      // Reuse slippage tolerance as headroom on BounceTech's idle-USDC buffer.
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
