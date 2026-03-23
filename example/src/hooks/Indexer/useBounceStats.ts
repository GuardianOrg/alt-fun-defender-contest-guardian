import { useQuery } from "@tanstack/react-query";

import { INDEX_API } from "../../app/api";

export interface BounceStats {
  marginVolume: number;
  notionalVolume: number;
  averageLeverage: number;
  supportedAssets: number;
  leveragedTokens: number;
  uniqueUsers: number;
  totalValueLocked: number;
  openInterest: number;
  totalTrades: number;
}

const useBounceStats = (): BounceStats => {
  const { data } = useQuery({
    queryKey: ["bounceStats"],
    queryFn: async () => {
      const res = await fetch(`${INDEX_API}stats`);
      const data = await res.json();
      if (data.status !== "success") {
        throw new Error(`Failed to fetch user Bounce stats: ${data.error}`);
      }
      return data.data;
    },
  });

  return {
    marginVolume: data?.marginVolume || 0,
    notionalVolume: data?.notionalVolume || 0,
    averageLeverage: data?.averageLeverage || 0,
    supportedAssets: data?.supportedAssets || 0,
    leveragedTokens: data?.leveragedTokens || 0,
    uniqueUsers: data?.uniqueUsers || 0,
    totalValueLocked: data?.totalValueLocked || 0,
    openInterest: data?.openInterest || 0,
    totalTrades: data?.totalTrades || 0,
  };
};

export default useBounceStats;
