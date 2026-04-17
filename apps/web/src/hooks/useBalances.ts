import { useQuery } from "@tanstack/react-query";
import { createPublicClient, formatUnits, http } from "viem";

import { useMarketData } from "./useMarketData";
import { useTokenPrices } from "./useTokenPrices";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { erc20Abi } from "../contracts/abis";
import { fetchBalances, fetchTokens } from "../services/api";

import type { HeldToken } from "../services/types";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

interface RawBalance {
  address: string;
  name: string;
  ticker: string;
  ltPair: string;
  leverage: number;
  balance: bigint;
}

async function fetchRawBalancesFromApi(
  walletAddress: string,
): Promise<RawBalance[]> {
  const rawBalances = await fetchBalances(walletAddress);
  return rawBalances.map((b) => ({
    address: b.address,
    name: b.name,
    ticker: b.ticker,
    ltPair: b.ltPair,
    leverage: b.leverage,
    balance: BigInt(b.balance),
  }));
}

async function fetchRawBalancesFromChain(
  walletAddress: string,
): Promise<RawBalance[]> {
  const tokens = await fetchTokens(100);
  if (tokens.length === 0) return [];

  const balanceCalls = tokens.map((token) => ({
    address: token.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf" as const,
    args: [walletAddress as `0x${string}`],
  }));

  const results = await hyperEvmClient.multicall({
    contracts: balanceCalls,
    allowFailure: true,
  });

  const balances: RawBalance[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const result = results[i];
    if (result.status === "success") {
      const balance = result.result as bigint;
      if (balance > 0n) {
        balances.push({
          address: tokens[i].address,
          name: tokens[i].name,
          ticker: tokens[i].ticker,
          ltPair: tokens[i].ltPair,
          leverage: tokens[i].leverage,
          balance,
        });
      }
    }
  }
  return balances;
}

export function useBalances() {
  const { address } = useWallet();
  const { getPrice, isLoading: pricesLoading } = useTokenPrices();
  const { getTokenMarketData } = useMarketData();

  const query = useQuery({
    queryKey: ["balances", address],
    queryFn: async (): Promise<RawBalance[]> => {
      if (!address) throw new Error("Address required");
      try {
        return await fetchRawBalancesFromApi(address);
      } catch {
        return fetchRawBalancesFromChain(address);
      }
    },
    enabled: !!address,
  });

  const MIN_DISPLAY_VALUE_USD = 0.1;

  const tokens: HeldToken[] = (query.data ?? [])
    .map((b) => {
      const amount = parseFloat(formatUnits(b.balance, 18));
      const pricePerToken = getPrice(b.address);
      const marketEntry = getTokenMarketData(b.address);
      return {
        address: b.address,
        name: b.name,
        ticker: b.ticker,
        emoji: "",
        ltName: `${b.ltPair} ${b.leverage}×`,
        status: "active" as const,
        amount,
        valueUsd: amount * pricePerToken,
        change24h: marketEntry?.change24h ?? null,
      };
    })
    .filter((t) => pricesLoading || t.valueUsd >= MIN_DISPLAY_VALUE_USD);

  const totalValue = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    tokens,
    totalValue,
    isLoading: query.isLoading || pricesLoading,
  };
}
