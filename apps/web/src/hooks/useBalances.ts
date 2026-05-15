import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, formatUnits, http } from "viem";

import { useMarketData } from "./useMarketData";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { DEFAULT_TOKEN_IMAGE } from "../config/constants";
import { erc20Abi } from "../contracts/abis";
import { API_BASE, fetchAllTokens, fetchBalances } from "../services/api";

import type { HeldToken } from "../services/types";

/**
 * Token logos are stored as root-relative paths in the API DB so the same
 * row renders against any frontend's `API_BASE`. The balances path bypasses
 * `fromApiToken`'s normaliser (it builds `HeldToken` directly), so we
 * resolve here too — otherwise every "My Positions" logo loads from the
 * webapp's own origin and 404s.
 */
function resolveImageUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_TOKEN_IMAGE;
  return new URL(raw, API_BASE).toString();
}

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

export interface RawBalance {
  address: string;
  name: string;
  ticker: string;
  ltPair: string;
  leverage: number;
  balance: bigint;
  imageUrl: string;
  /**
   * `true` when the token is currently admin-hidden from public listings.
   * Holders still see the position so they can sell it (issue #712); the
   * row is marked so the UI can render the policy disclaimer and disable
   * buys.
   */
  isHidden: boolean;
}

/**
 * Minimum USD value a position must clear to render. Anything below is
 * dust — typically a leftover sliver from a fully-sold token. Runs
 * unconditionally: when prices haven't loaded `getPrice` returns 0,
 * collapsing every `valueUsd` to 0 and cleanly hiding ghost rows during
 * the prices-loading window. The consumer's skeleton path already keys
 * off the combined `isLoading`, so the loading state is covered without
 * surfacing $0 placeholders.
 */
export const MIN_DISPLAY_VALUE_USD = 0.1;

/**
 * Pure builder for the `HeldToken[]` list. Extracted so the dust-filter
 * contract is exercisable in unit tests without standing up React Query
 * / viem / Privy.
 */
export function buildHeldTokens(
  rawBalances: readonly RawBalance[],
  getPrice: (address: string) => number,
  getTokenMarketData: (
    address: string,
  ) => { change24h?: number | null } | undefined,
): HeldToken[] {
  return rawBalances
    .map((b) => {
      const amount = parseFloat(formatUnits(b.balance, 18));
      const pricePerToken = getPrice(b.address);
      const marketEntry = getTokenMarketData(b.address);
      return {
        address: b.address,
        name: b.name,
        ticker: b.ticker,
        emoji: "",
        image: resolveImageUrl(b.imageUrl),
        ltName: `${b.ltPair} ${b.leverage}×`,
        status: "active" as const,
        amount,
        valueUsd: amount * pricePerToken,
        change24h: marketEntry?.change24h ?? null,
        isHidden: b.isHidden,
      };
    })
    .filter((t) => t.valueUsd >= MIN_DISPLAY_VALUE_USD);
}

/**
 * Primary path: read the wallet's positions from the indexer-backed
 * `/api/v1/balances/:wallet` route. The route is wallet-scoped via Ponder
 * (`tokenBalances where wallet=…, balance_gt: 0`), joins token metadata
 * server-side, and includes admin-hidden tokens for holders so they can
 * sell out (issue #712). One HTTP call regardless of catalogue size.
 */
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
    imageUrl: b.imageUrl,
    isHidden: b.isHidden,
  }));
}

/**
 * Fallback when the API/indexer is unavailable: walk every public-catalogue
 * token and probe `balanceOf` via a chunked viem multicall. Chunked at 250
 * tokens because HyperEVM small blocks cap multicalls at ~2M gas and a
 * fully-grown catalogue in one tx will revert with `out of gas`. Hidden
 * tokens aren't in `fetchAllTokens`, so they won't surface during a
 * fallback — acceptable given this only fires while the API is down.
 */
async function fetchRawBalancesFromChain(
  walletAddress: string,
): Promise<RawBalance[]> {
  const tokens = await fetchAllTokens();
  if (tokens.length === 0) {
    throw new Error("Token catalogue unavailable");
  }

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
      const token = tokenChunk[i];
      if (result.status !== "success") continue;
      const balance = result.result as bigint;
      if (balance <= 0n) continue;
      balances.push({
        address: token.address,
        name: token.name,
        ticker: token.ticker,
        ltPair: token.ltPair,
        leverage: token.leverage,
        balance,
        imageUrl: token.imageUrl,
        isHidden: false,
      });
    }
  }
  return balances;
}

/**
 * React Query-backed hook powering the "MY POSITIONS" panel and the
 * Earnings / Profile balances tabs. Joins the indexer-backed `/balances`
 * read with the market-data cache (one query drives both the per-token
 * `priceUsd` lookup the dust filter reads via `getPrice` and the
 * `change24h` row column). On API failure, falls back to a chunked
 * `balanceOf` multicall against the full catalogue.
 */
export function useBalances() {
  const { address } = useWallet();

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

  const heldAddresses = useMemo(
    () => (query.data ?? []).map((b) => b.address),
    [query.data],
  );
  const {
    getPrice,
    getTokenMarketData,
    isLoading: marketLoading,
  } = useMarketData(heldAddresses);

  const tokens = buildHeldTokens(query.data ?? [], getPrice, getTokenMarketData);

  const totalValue = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    tokens,
    totalValue,
    isLoading: query.isLoading || marketLoading,
  };
}
