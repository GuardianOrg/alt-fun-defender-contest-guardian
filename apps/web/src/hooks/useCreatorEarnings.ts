import { useState, useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { creatorService } from "../services/creatorService";

export function useCreatorEarnings() {
  const { address } = useAccount();
  const [claiming, setClaiming] = useState(false);

  const earningsQuery = useQuery({
    queryKey: ["creatorEarnings", address],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return creatorService.getEarnings(address);
    },
    enabled: !!address,
  });

  const claim = useCallback(
    async (tokenAddress?: string) => {
      if (!address) return;
      setClaiming(true);
      try {
        await creatorService.claimEarnings(address, tokenAddress);
        earningsQuery.refetch();
      } finally {
        setClaiming(false);
      }
    },
    [address, earningsQuery],
  );

  return {
    earnings: earningsQuery.data,
    isLoading: earningsQuery.isLoading,
    isError: earningsQuery.isError,
    error: earningsQuery.error,
    claiming,
    claim,
  };
}

export function useBalances() {
  const { address } = useAccount();

  const query = useQuery({
    queryKey: ["balances", address],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return creatorService.getBalances(address);
    },
    enabled: !!address,
  });

  const totalValue = query.data?.reduce((sum, t) => sum + t.valueUsd, 0) ?? 0;

  return {
    tokens: query.data ?? [],
    totalValue,
    isLoading: query.isLoading,
  };
}
