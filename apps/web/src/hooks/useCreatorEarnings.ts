import { useState, useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import { BondingAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";
import { creatorService } from "../services/creatorService";

export function useCreatorEarnings() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
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
      if (!address || !walletClient || !publicClient) return;
      setClaiming(true);
      try {
        let ltAddress: `0x${string}`;
        if (tokenAddress) {
          const info = (await publicClient.readContract({
            address: ADDRESSES.bonding,
            abi: BondingAbi,
            functionName: "tokenInfo",
            args: [tokenAddress as `0x${string}`],
          })) as readonly [string, string, string, string, string, string, boolean, boolean];
          ltAddress = info[3] as `0x${string}`;
        } else {
          const firstToken = earningsQuery.data?.tokens.find(
            (t) => t.feesClaimableUsd > 0,
          );
          if (!firstToken) return;
          const info = (await publicClient.readContract({
            address: ADDRESSES.bonding,
            abi: BondingAbi,
            functionName: "tokenInfo",
            args: [firstToken.address as `0x${string}`],
          })) as readonly [string, string, string, string, string, string, boolean, boolean];
          ltAddress = info[3] as `0x${string}`;
        }

        const hash = await walletClient.writeContract({
          address: ADDRESSES.bonding,
          abi: BondingAbi,
          functionName: "claimCreatorFees",
          args: [ltAddress],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        earningsQuery.refetch();
      } finally {
        setClaiming(false);
      }
    },
    [address, walletClient, publicClient, earningsQuery],
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
