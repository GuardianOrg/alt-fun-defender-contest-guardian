import { useEffect } from "react";

import { useQuery } from "@tanstack/react-query";

import { INDEX_API } from "../../app/api";
import { REFRESH_INTERVAL } from "../../app/constants";
import useBounceAccount from "../../web3/views/useBounceAccount";

import type { Address } from "viem";

export interface LeveragedTokenPnl {
  realized: number;
  unrealized: number;
  unrealizedPercent: number;
}

export interface UserPnl {
  totalRealized: number;
  totalUnrealized: number;
  leveragedTokens: Record<Address, LeveragedTokenPnl>;
}

const usePnl = (): UserPnl | null => {
  const { address: usersAddress } = useBounceAccount();

  const { data, isLoading, error } = useQuery({
    queryKey: ["userPnl", usersAddress],
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !!usersAddress,
    queryFn: async () => {
      const res = await fetch(`${INDEX_API}user-pnl?user=${usersAddress}`);
      const data = await res.json();
      if (data.status !== "success") {
        throw new Error(`Failed to fetch user PnL: ${data.error}`);
      }
      return data.data;
    },
    placeholderData: (previousData) => previousData,
  });

  // Because we spam this every second, we're just doing silent error handling
  useEffect(() => {
    if (!error) return;
    console.error(error);
  }, [error]);

  if (isLoading) return null;
  if (error) return null;
  if (!data) return null;
  return data;
};

export default usePnl;
