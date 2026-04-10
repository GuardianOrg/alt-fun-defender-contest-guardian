import { useQuery } from "@tanstack/react-query";

import type { Address } from "viem";

export interface Liquidator {
  address: Address;
  totalLiquidationNotional: number;
  totalLiquidationCount: number;
  score: number;
  rank: number;
}

export interface LiquidationLeaderboardData {
  items: Liquidator[];
  totalCount: number;
  page: number;
  totalPages: number;
}

export type LiquidationLeaderboardSortByOptions =
  | "totalLiquidationNotional"
  | "totalLiquidationCount"
  | "score";

interface LiquidationLeaderboardQueryState {
  sortBy?: LiquidationLeaderboardSortByOptions;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

const buildParams = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined) as [
      string,
      string,
    ][],
  );

const useLiquidationLeaderboardData = (
  state?: LiquidationLeaderboardQueryState,
) => {
  const {
    sortBy = "totalLiquidationNotional",
    sortOrder = "desc",
    page = 1,
    limit = 10,
  } = state ?? {};

  const params = buildParams({
    sortBy,
    sortOrder,
    page,
    limit,
  });

  const { data: rawData, isLoading } = useQuery({
    queryKey: ["liquidations", params.toString()],
    queryFn: async () => {
      const res = await fetch(`https://api.bounce.tech/liquidations?${params}`);
      const json = await res.json();
      return json.data as LiquidationLeaderboardData;
    },
  });

  return {
    data: rawData || null,
    isLoading,
  };
};

export default useLiquidationLeaderboardData;
