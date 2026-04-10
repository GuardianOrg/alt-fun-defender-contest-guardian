import { useQuery } from "@tanstack/react-query";

export interface LiquidationAsset {
  asset: string;
  totalLiquidationNotional: number;
  totalLiquidationCount: number;
  topPercent: number;
}

export interface LiquidationMonth {
  month: string;
  totalLiquidationNotional: number;
  totalLiquidationCount: number;
}

export interface LiquidationJourneyData {
  user: string;
  totalLiquidationNotional: number;
  totalLiquidationCount: number;
  topPercent: number;
  rarestAsset: string;
  firstLiquidation: {
    timestamp: number;
    asset: string;
    notional: number;
    isLong: boolean;
    price: number;
  };
  assets: LiquidationAsset[];
  liquidationsPerMonth: LiquidationMonth[];
  liquidatedOnTenthOfOctober2025: boolean;
  score: number;
  hasClaimed: boolean;
  rank: number;
}
interface UseLiquidationJourneyResult {
  data: LiquidationJourneyData | null;
  isLoading: boolean;
}

const useLiquidationJourneyData = (
  address: string | null,
): UseLiquidationJourneyResult => {
  const { data: rawData, isLoading } = useQuery({
    queryKey: ["liquidation-journey-data", address],
    queryFn: async () => {
      if (!address) return null;

      const res = await fetch(
        `https://api.bounce.tech/liquidation-data/${address}`,
      );
      const json = await res.json();
      return json.data as LiquidationJourneyData;
    },
    enabled: !!address,
  });

  return {
    data: rawData || null,
    isLoading,
  };
};

export default useLiquidationJourneyData;
