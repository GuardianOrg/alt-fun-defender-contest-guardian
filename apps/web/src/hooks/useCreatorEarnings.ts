import { useState, useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { BondingAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";
import { creatorService } from "../services/creatorService";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

export function useCreatorEarnings() {
  const { address } = useWallet();
  const walletClient = usePrivyWalletClient();
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
      if (!address || !walletClient) return;
      setClaiming(true);
      try {
        const tokensList = earningsQuery.data?.tokens ?? [];
        const target = tokenAddress
          ? tokensList.find(
              (t) => t.address.toLowerCase() === tokenAddress.toLowerCase(),
            )
          : tokensList.find((t) => t.feesClaimableUsd > 0);
        if (!target) return;

        const ltAddress = target.ltAddress as `0x${string}`;
        const hash = await walletClient.writeContract({
          address: ADDRESSES.bonding,
          abi: BondingAbi,
          functionName: "claimCreatorFees",
          args: [ltAddress],
        });
        const receipt = await hyperEvmClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          throw new Error("Claim transaction reverted on-chain");
        }
        earningsQuery.refetch();
      } finally {
        setClaiming(false);
      }
    },
    [address, walletClient, earningsQuery],
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
