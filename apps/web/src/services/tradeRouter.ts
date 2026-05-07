import {
  BondingAbi,
  FactoryAbi,
  LeveragedTokenAbi,
  RouterAbi,
} from "@launchpad/shared";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";


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
// `Zap` charges this same 0.5% on both paths and forwards it to
// `FeeVault`, so quotes don't need to special-case graduated tokens — the
// fee math here mirrors the on-chain deduction regardless of execution venue.
//
// HyperSwap V2 takes its own 0.3% on the LT-side input (post-grad path).
// Mirrored here so post-grad quotes match what `Zap._buyOnHyperswap` /
// `_sellOnHyperswap` actually receives back from the DEX.
const HYPERSWAP_FEE_BPS = 30; // 0.30% — UniswapV2-style "fee on input"
const BPS_DENOM = 10_000;

const HYPER_EVM_RPC = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";

const publicClient = createPublicClient({
  transport: http(HYPER_EVM_RPC),
});

export type TransactionStep = "idle" | "approving" | "signing" | "confirmed" | "error";
export type TxStep = TransactionStep | "executing";
export type LaunchStep = TransactionStep | "deploying";

export interface BuyQuote {
  tokensOut: string;
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
  getQuoteBuy(curveAddress: string, usdcAmount: number): Promise<BuyQuote | null>;
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
  if (
    hyperswapPair === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error(
      `HyperSwap pair missing for graduated token ${tokenAddress} ` +
        `(factory=${ADDRESSES.hyperswapFactory}, lt=${ltAddress}). ` +
        `Check HYPERSWAP_ADDRESSES.factory matches the active chain.`,
    );
  }

  // V2 sorts pair tokens by ascending address at creation time (cf.
  // `IUniswapV2Library.sortTokens`); cache the comparison so callers can
  // map reserves without re-fetching `token0()`.
  const tokenIsToken0 =
    tokenAddress.toLowerCase() < ltAddress.toLowerCase();

  return {
    pairAddress: hyperswapPair,
    ltAddress,
    graduated: true,
    tokenIsToken0,
  };
}

const liveTradeRouter: ITradeRouterService = {
  async getQuoteBuy(curveAddress, usdcAmount) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress, graduated, tokenIsToken0 } =
        await getPairContext(tokenAddr);

      const [reserves, exchangeRate] = await Promise.all([
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
      ]);

      const [reserve0, reserve1] = reserves;
      const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
      const ltReserve = tokenIsToken0 ? reserve1 : reserve0;

      const exRate = parseFloat(formatUnits(exchangeRate, 18));
      const ltReserveFloat = parseFloat(formatUnits(ltReserve, 18));
      const tokenReserveFloat = parseFloat(formatUnits(tokenReserve, 18));

      const curveFee = usdcAmount * FEES.curveBuy;
      const netUsdc = usdcAmount - curveFee;
      const ltIn = netUsdc / exRate;

      let tokensOut: number;
      let usdcUsed = netUsdc;
      let capped = false;

      if (graduated) {
        // Post-grad: HyperSwap V2 0.30% fee on input. previewBuy is
        // curve-only so we keep the JS math here.
        const effectiveLtIn = (ltIn * (BPS_DENOM - HYPERSWAP_FEE_BPS)) / BPS_DENOM;
        tokensOut =
          ltReserveFloat > 0
            ? (tokenReserveFloat * effectiveLtIn) /
              (ltReserveFloat + effectiveLtIn)
            : 0;
      } else {
        // Curve path: defer to `Router.previewBuy` so the quote honours the
        // overflow cap on graduating buys (matches `Zap._executeBuy`).
        const ltInWei = parseUnits(ltIn.toFixed(18), 18);
        const [amountInUsedWei, tokensOutWei] = (await publicClient.readContract({
          address: ADDRESSES.router,
          abi: RouterAbi,
          functionName: "previewBuy",
          args: [tokenAddr, ltInWei],
        })) as readonly [bigint, bigint];

        tokensOut = parseFloat(formatUnits(tokensOutWei, 18));
        const ltUsed = parseFloat(formatUnits(amountInUsedWei, 18));
        capped = amountInUsedWei < ltInWei;
        if (capped) usdcUsed = ltUsed * exRate;
      }

      const priceImpact =
        ltReserveFloat > 0 ? (ltIn / ltReserveFloat) * 100 : 0;

      // Cap-binding curve buys: only the consumed slice is charged the curve
      // fee on-chain, the remainder is refunded as USDC. `youPay` shows the
      // user's net spend so the displayed total isn't misleading.
      const youPay = capped ? usdcUsed + usdcUsed * FEES.curveBuy : usdcAmount;

      return {
        tokensOut: tokensOut.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        }),
        curveFee: capped ? usdcUsed * FEES.curveBuy : curveFee,
        totalFee: capped ? usdcUsed * FEES.curveBuy : curveFee,
        priceImpactPct: parseFloat(priceImpact.toFixed(2)),
        youPay,
        youReceive: `${(tokensOut / 1e6).toFixed(1)}M`,
        usdcUsed,
        capped,
      };
    } catch {
      return null;
    }
  },

  async getQuoteSell(curveAddress, tokenAmount, slippage = 0, leverage = 2) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress, graduated, tokenIsToken0 } =
        await getPairContext(tokenAddr);

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
        tokenReserveFloat > 0
          ? (tokenAmount / tokenReserveFloat) * 100
          : 0;

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
