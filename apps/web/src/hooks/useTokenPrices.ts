import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";

import { hyperEVM } from "../config/chains";
import { TOKEN_SUPPLY } from "../config/constants";
import { FFactoryAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";
import { fetchTokens } from "../services/api";
import { getLtExchangeRates } from "../services/exchangeRates";
import { fetchPonderTokens } from "../services/ponder";

import type { PonderToken } from "../services/ponder";

const STALE_TIME = 30_000;
const REFETCH_INTERVAL = 30_000;

const RATIO_PRECISION = 10n ** 18n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const publicClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

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

export interface TokenPriceData {
  priceUsd: number;
  mcapUsd: number;
}

export type TokenPriceMap = Record<string, TokenPriceData>;

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * RATIO_PRECISION) / denominator) / 1e18;
}

interface CurveState {
  address: string;
  ltToken: string;
  tokenReserve: bigint;
  ltReserve: bigint;
}

async function getCurveStatesFromPonder(): Promise<CurveState[]> {
  const tokens = await fetchPonderTokens(100);
  return tokens.map((t: PonderToken) => ({
    address: t.address,
    ltToken: t.ltToken,
    tokenReserve: BigInt(t.curveSupply),
    ltReserve: BigInt(t.ltReserve),
  }));
}

async function getCurveStatesFromChain(): Promise<CurveState[]> {
  const apiTokens = await fetchTokens(100);
  if (apiTokens.length === 0) return [];

  const pairCalls = apiTokens.map((t) => ({
    address: ADDRESSES.factory,
    abi: FFactoryAbi,
    functionName: "pairFor" as const,
    args: [t.address as `0x${string}`],
  }));

  const pairResults = await publicClient.multicall({
    contracts: pairCalls,
    allowFailure: true,
  });

  const validPairs: { index: number; pairAddress: `0x${string}` }[] = [];
  for (let i = 0; i < pairResults.length; i++) {
    const r = pairResults[i];
    if (r.status === "success" && r.result !== ZERO_ADDRESS) {
      validPairs.push({ index: i, pairAddress: r.result as `0x${string}` });
    }
  }

  if (validPairs.length === 0) return [];

  const reserveCalls = validPairs.map(({ pairAddress }) => ({
    address: pairAddress,
    abi: FPairAbi,
    functionName: "getReserves" as const,
  }));

  const reserveResults = await publicClient.multicall({
    contracts: reserveCalls,
    allowFailure: true,
  });

  const states: CurveState[] = [];
  for (let j = 0; j < validPairs.length; j++) {
    const reserveResult = reserveResults[j];
    if (reserveResult.status === "success") {
      const i = validPairs[j].index;
      const [tokenReserve, ltReserve] = reserveResult.result as [bigint, bigint];
      states.push({
        address: apiTokens[i].address,
        ltToken: apiTokens[i].ltPair,
        tokenReserve,
        ltReserve,
      });
    }
  }
  return states;
}

async function computeTokenPrices(): Promise<TokenPriceMap> {
  let curveStates: CurveState[];
  try {
    curveStates = await getCurveStatesFromPonder();
  } catch {
    curveStates = await getCurveStatesFromChain();
  }

  if (curveStates.length === 0) return {};

  const rates = await getLtExchangeRates();

  const prices: TokenPriceMap = {};
  for (const state of curveStates) {
    const ratio = bigintRatio(state.ltReserve, state.tokenReserve);
    const exRate = rates.get(state.ltToken.toLowerCase()) ?? 0;
    const priceUsd = ratio * exRate;
    prices[state.address.toLowerCase()] = {
      priceUsd,
      mcapUsd: priceUsd * TOKEN_SUPPLY,
    };
  }
  return prices;
}

export function useTokenPrices() {
  const query = useQuery({
    queryKey: ["token-prices"],
    queryFn: computeTokenPrices,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  });

  const prices = query.data ?? {};

  const getPrice = (address: string): number => {
    return prices[address.toLowerCase()]?.priceUsd ?? 0;
  };

  const getMcap = (address: string): number => {
    return prices[address.toLowerCase()]?.mcapUsd ?? 0;
  };

  return {
    prices,
    getPrice,
    getMcap,
    isLoading: query.isLoading,
  };
}
