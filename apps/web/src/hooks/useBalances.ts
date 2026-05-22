import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";

import { useMarketData } from "./useMarketData";
import { useWallet } from "./useWallet";
import { DEFAULT_TOKEN_IMAGE } from "../config/constants";
import { API_BASE, fetchBalances } from "../services/api";

import type { HeldToken } from "../services/types";

/** Balances builds `HeldToken` directly, so resolve root-relative image URLs here. */
function resolveImageUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_TOKEN_IMAGE;
  return new URL(raw, API_BASE).toString();
}

export interface RawBalance {
  address: string;
  name: string;
  ticker: string;
  ltPair: string;
  leverage: number;
  balance: bigint;
  imageUrl: string;
  /** Admin-hidden tokens still appear to holders so they can sell. */
  isHidden: boolean;
}

// Hide dust and suppress ghost rows while prices are still loading.
export const MIN_DISPLAY_VALUE_USD = 0.1;

/** Pure builder for unit-testing the dust filter. */
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

/** Fetch wallet positions via the indexer-backed balances endpoint. */
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

/** Powers MY POSITIONS and profile balances by joining balances with market data. */
export function useBalances() {
  const { address } = useWallet();

  const query = useQuery({
    queryKey: ["balances", address],
    queryFn: async (): Promise<RawBalance[]> => {
      if (!address) throw new Error("Address required");
      try {
        return await fetchRawBalancesFromApi(address);
      } catch (error) {
        // Re-throw so React Query can retry instead of showing a false empty state.
        console.error("Failed to fetch balances from API", error);
        throw error;
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

  const tokens = buildHeldTokens(
    query.data ?? [],
    getPrice,
    getTokenMarketData,
  );

  const totalValue = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    tokens,
    totalValue,
    isLoading: query.isLoading || marketLoading,
  };
}
