import { FFactoryAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http } from "viem";


import { FEES, MOCK_TOKEN_PRICE } from "../config/constants";
import { ADDRESSES } from "../contracts/addresses";

const HYPER_EVM_RPC = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";

const publicClient = createPublicClient({
  transport: http(HYPER_EVM_RPC),
});

const ILTAbi = [
  {
    name: "exchangeRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

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
}

export interface ITradeRouterService {
  getQuoteBuy(curveAddress: string, usdcAmount: number): Promise<BuyQuote>;
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
          abi: ILTAbi,
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
      return mockBuyQuote(usdcAmount);
    }
  },

  async getQuoteSell(curveAddress, tokenAmount) {
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
          abi: ILTAbi,
          functionName: "exchangeRate",
        }) as Promise<bigint>,
      ]);

      const [tokenReserve, ltReserve] = reserves;
      const exRate = parseFloat(formatUnits(exchangeRate, 18));
      const ltReserveFloat = parseFloat(formatUnits(ltReserve, 18));
      const tokenReserveFloat = parseFloat(formatUnits(tokenReserve, 18));

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

      return {
        usdcOut: netUsdc,
        curveFee,
        ltRedemptionFee,
        totalFee,
        priceImpactPct: parseFloat(priceImpact.toFixed(2)),
        youReceive: netUsdc,
      };
    } catch {
      return null;
    }
  },
};

function mockBuyQuote(usdcAmount: number): BuyQuote {
  const curveFee = usdcAmount * FEES.curveBuy;
  const netUsdc = usdcAmount - curveFee;
  const tokensOut = netUsdc / MOCK_TOKEN_PRICE;
  const mockMcap = MOCK_TOKEN_PRICE * 1e9;
  const priceImpact = (usdcAmount / mockMcap) * 100;
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
}


export const tradeRouterService: ITradeRouterService = liveTradeRouter;
