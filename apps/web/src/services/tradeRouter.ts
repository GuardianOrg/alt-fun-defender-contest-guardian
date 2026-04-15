import { FFactoryAbi, LeveragedTokenAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http } from "viem";


import { FEES } from "../config/constants";
import { ADDRESSES } from "../contracts/addresses";

const HYPER_EVM_RPC = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";

const publicClient = createPublicClient({
  transport: http(HYPER_EVM_RPC),
});

export type TransactionStep = "idle" | "approving" | "confirmed" | "error";
export type TxStep = TransactionStep | "executing";
export type LaunchStep = TransactionStep | "deploying";

export interface BuyQuote {
  tokensOut: string;
  curveFee: number;
  totalFee: number;
  priceImpactPct: number;
  youPay: number;
  youReceive: string;
}

export interface SellQuote {
  usdcOut: number;
  curveFee: number;
  ltRedemptionFee: number;
  totalFee: number;
  priceImpactPct: number;
  youReceive: number;
  /** Max token amount sellable right now given the LT's idle USDC buffer */
  maxSellableTokens: number;
  /** Available idle USDC in the LT contract for atomic redeems */
  bufferUsdc: number;
  /** Whether the requested sell exceeds the available buffer */
  exceedsBuffer: boolean;
}

export interface ITradeRouterService {
  getQuoteBuy(curveAddress: string, usdcAmount: number): Promise<BuyQuote | null>;
  getQuoteSell(
    curveAddress: string,
    tokenAmount: number,
  ): Promise<SellQuote | null>;
}

async function getTokenPair(
  tokenAddress: `0x${string}`,
): Promise<{ pairAddress: `0x${string}`; ltAddress: `0x${string}` }> {
  const [pairAddress, ltAddress] = await Promise.all([
    publicClient.readContract({
      address: ADDRESSES.factory,
      abi: FFactoryAbi,
      functionName: "pairFor",
      args: [tokenAddress],
    }) as Promise<`0x${string}`>,
    publicClient.readContract({
      address: ADDRESSES.factory,
      abi: FFactoryAbi,
      functionName: "ltFor",
      args: [tokenAddress],
    }) as Promise<`0x${string}`>,
  ]);
  return { pairAddress, ltAddress };
}

const FPairAbi = [
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

const liveTradeRouter: ITradeRouterService = {
  async getQuoteBuy(curveAddress, usdcAmount) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress } = await getTokenPair(tokenAddr);

      const [reserves, exchangeRate] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: FPairAbi,
          functionName: "getReserves",
        }) as Promise<[bigint, bigint]>,
        publicClient.readContract({
          address: ltAddress,
          abi: LeveragedTokenAbi,
          functionName: "exchangeRate",
        }) as Promise<bigint>,
      ]);

      const [tokenReserve, ltReserve] = reserves;
      const exRate = parseFloat(formatUnits(exchangeRate, 18));
      const ltReserveFloat = parseFloat(formatUnits(ltReserve, 18));
      const tokenReserveFloat = parseFloat(formatUnits(tokenReserve, 18));

      const curveFee = usdcAmount * FEES.curveBuy;
      const netUsdc = usdcAmount - curveFee;
      const ltIn = netUsdc / exRate;
      const tokensOut =
        (tokenReserveFloat * ltIn) / (ltReserveFloat + ltIn);
      const priceImpact =
        ltReserveFloat > 0 ? (ltIn / ltReserveFloat) * 100 : 0;

      return {
        tokensOut: tokensOut.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        }),
        curveFee,
        totalFee: curveFee,
        priceImpactPct: parseFloat(priceImpact.toFixed(2)),
        youPay: usdcAmount,
        youReceive: `${(tokensOut / 1e6).toFixed(1)}M`,
      };
    } catch {
      return null;
    }
  },

  async getQuoteSell(curveAddress, tokenAmount) {
    try {
      const tokenAddr = curveAddress as `0x${string}`;
      const { pairAddress, ltAddress } = await getTokenPair(tokenAddr);

      const [reserves, exchangeRate, baseAssetBal] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: FPairAbi,
          functionName: "getReserves",
        }) as Promise<[bigint, bigint]>,
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

      const [tokenReserve, ltReserve] = reserves;
      const exRate = parseFloat(formatUnits(exchangeRate, 18));
      const ltReserveFloat = parseFloat(formatUnits(ltReserve, 18));
      const tokenReserveFloat = parseFloat(formatUnits(tokenReserve, 18));
      const bufferUsdc = parseFloat(formatUnits(baseAssetBal, 6));

      const ltOut =
        (ltReserveFloat * tokenAmount) / (tokenReserveFloat + tokenAmount);
      const grossUsdc = ltOut * exRate;
      const curveFee = grossUsdc * FEES.curveSell;
      const ltRedemptionFee = grossUsdc * FEES.ltRedemption * 2;
      const totalFee = curveFee + ltRedemptionFee;
      const netUsdc = grossUsdc - totalFee;
      const priceImpact =
        tokenReserveFloat > 0
          ? (tokenAmount / tokenReserveFloat) * 100
          : 0;

      const bufferLt = exRate > 0 ? bufferUsdc / exRate : 0;
      const bufferBinds = bufferLt > 0 && ltReserveFloat > bufferLt;
      const maxSellableTokens = bufferBinds
        ? (tokenReserveFloat * bufferLt) / (ltReserveFloat - bufferLt)
        : Infinity;
      const safeMaxSellable = Number.isFinite(maxSellableTokens)
        ? Math.max(0, maxSellableTokens)
        : Infinity;

      const redeemUsdc = grossUsdc - curveFee;
      const exceedsBuffer = redeemUsdc > bufferUsdc;

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
