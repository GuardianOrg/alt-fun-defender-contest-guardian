import { useQuery } from "@tanstack/react-query";

import { INDEX_API } from "../../app/api";
import { REFRESH_INTERVAL } from "../../app/constants";
import useBounceAccount from "../../web3/views/useBounceAccount";

import type { Asset } from "../../constants/targetAssets";
import type { Address } from "viem";

interface IndexerTrade {
  id: string;
  txHash: Address;
  timestamp: string;
  isBuy: boolean;
  baseAssetAmount: string;
  leveragedTokenAmount: string;
  leveragedToken: Address;
  targetLeverage: number;
  isLong: boolean;
  targetAsset: Asset;
  profitAmount: number | null;
  profitPercent: number | null;
}

interface IndexerTradesResponse {
  items: IndexerTrade[];
  totalCount: number;
  page: number;
  totalPages: number;
}

export interface Trade extends Omit<
  IndexerTrade,
  "timestamp" | "baseAssetAmount" | "leveragedTokenAmount"
> {
  timestamp: number;
  baseAssetAmount: bigint;
  leveragedTokenAmount: bigint;
}

interface TradesResponse extends Omit<IndexerTradesResponse, "items"> {
  items: Trade[];
}

export type TradesSortByOptions =
  | "date"
  | "targetAsset"
  | "activity"
  | "nomVal"
  | "pnlAmount"
  | "pnlPercent";

interface TradesQueryState {
  targetAsset?: Asset;
  address?: Address;
  sortBy?: TradesSortByOptions;
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

const useAllUserTrades = (state?: TradesQueryState) => {
  const { address: usersAddress } = useBounceAccount();

  const {
    targetAsset,
    address,
    sortBy = "date",
    sortOrder = "desc",
    page = 1,
    limit = 100,
  } = state ?? {};

  const normalizedLeveragedTokenAddress = address ?? undefined;

  return useQuery<IndexerTradesResponse, Error, TradesResponse>({
    queryKey: [
      "trades",
      usersAddress,
      targetAsset,
      normalizedLeveragedTokenAddress,
      sortBy,
      sortOrder,
      page,
      limit,
    ],
    enabled: !!usersAddress,
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<IndexerTradesResponse> => {
      const params = buildParams({
        targetAsset,
        address: normalizedLeveragedTokenAddress,
        sortBy,
        sortOrder,
        page,
        limit,
      });
      const res = await fetch(
        `${INDEX_API}trades/${usersAddress}?${params.toString()}`,
      );
      const json = await res.json();
      if (json.status !== "success") {
        throw new Error(json.error);
      }
      return json.data;
    },
    placeholderData: (previousData) => previousData,
    select: (data): TradesResponse => ({
      ...data,
      items: data.items.map(
        (trade): Trade => ({
          ...trade,
          timestamp: Number(trade.timestamp),
          baseAssetAmount: BigInt(trade.baseAssetAmount),
          leveragedTokenAmount: BigInt(trade.leveragedTokenAmount),
        }),
      ),
    }),
  });
};

export default useAllUserTrades;
