import { useState, useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { profileService } from "../services/creatorService";

export function useCreatorEarnings() {
  const { address } = useAccount();
  const [claiming, setClaiming] = useState(false);

  const earningsQuery = useQuery({
    queryKey: ["creatorEarnings", address],
    queryFn: () => profileService.getEarnings(address!),
    enabled: !!address,
  });

  const claim = useCallback(
    async (tokenAddress?: string) => {
      if (!address) return;
      setClaiming(true);
      try {
        await profileService.claimEarnings(address, tokenAddress);
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
    claiming,
    claim,
  };
}

export function useBalances() {
  const { address } = useAccount();

  const query = useQuery({
    queryKey: ["balances", address],
    queryFn: () => profileService.getBalances(address!),
    enabled: !!address,
  });

  const totalValue = query.data?.reduce((sum, t) => sum + t.valueUsd, 0) ?? 0;

  return {
    tokens: query.data ?? [],
    totalValue,
    isLoading: query.isLoading,
  };
}
