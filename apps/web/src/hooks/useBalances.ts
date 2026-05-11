import { useQuery } from "@tanstack/react-query";
import { createPublicClient, formatUnits, http } from "viem";

import { useMarketData } from "./useMarketData";
import { useTokenPrices } from "./useTokenPrices";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { erc20Abi } from "../contracts/abis";
import { fetchAllTokens, fetchBalances } from "../services/api";

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
  // Walk the full catalogue, not just the first page. The chain path is
  // primary (the indexer's `tokenBalance` index is empty until #418 ships)
  // and a hard-coded `fetchTokens(100)` cap means holders of any token
  // outside the first 100 silently see `0` for it on the balances panel
  // (issue #476). `fetchAllTokens` paginates server-side at 100/page; if
  // any page fails, the throw bubbles up to the queryFn's `catch` and
  // we fall through to the API fallback below.
  const tokens = await fetchAllTokens();
  // Empty catalogue almost certainly means the API is down (we always have
  // ≥1 token in production). Throw so `useBalances` falls through to the
  // indexer-backed API fallback rather than silently rendering "No
  // positions yet".
  if (tokens.length === 0) {
    throw new Error("Token catalogue unavailable");
  }

  // Chunk the multicall so a fully-grown catalogue doesn't blow past the
  // RPC's per-call gas / payload ceiling. viem's multicall packs every
  // call into a single `Multicall3.aggregate3` invocation; HyperEVM small
  // blocks have a ~2M gas cap, so a few thousand `balanceOf` calls in one
  // tx will revert with `out of gas`. 250 keeps us well under the
  // ceiling while still amortising the round-trip cost (~10 RPC calls
  // per 2.5K tokens). Build the call objects per-chunk (rather than
  // pre-allocating an N-length array of throwaway descriptors) so the
  // peak memory footprint scales with chunk size, not catalogue size.
  const MULTICALL_CHUNK_SIZE = 250;
  const balances: RawBalance[] = [];
  for (let start = 0; start < tokens.length; start += MULTICALL_CHUNK_SIZE) {
    const tokenChunk = tokens.slice(start, start + MULTICALL_CHUNK_SIZE);
    const chunkResults = await hyperEvmClient.multicall({
      contracts: tokenChunk.map((token) => ({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [walletAddress as `0x${string}`],
      })),
      allowFailure: true,
    });
    for (let i = 0; i < chunkResults.length; i++) {
      const result = chunkResults[i];
      if (result.status !== "success") continue;
      const balance = result.result as bigint;
      if (balance <= 0n) continue;
      const token = tokenChunk[i];
      balances.push({
        address: token.address,
        name: token.name,
        ticker: token.ticker,
        ltPair: token.ltPair,
        leverage: token.leverage,
        balance,
      });
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
      // On-chain multicall is authoritative and works regardless of indexer
      // health. The API path (`fetchRawBalancesFromApi`) reads the indexer's
      // `tokenBalance` index, which is currently empty for every token (see
      // bounce-tech/alt-fun#418 — `Token:Transfer` events are not being
      // ingested), so it silently returns no positions and the "MY POSITIONS"
      // panel always shows "No positions yet". Until #418 ships, chain is
      // the source of truth here; the API call is kept as a fallback for
      // RPC outages. Token catalogue is ~100 entries today, so the multicall
      // fits in a single RPC round-trip.
      try {
        return await fetchRawBalancesFromChain(address);
      } catch {
        return fetchRawBalancesFromApi(address);
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
