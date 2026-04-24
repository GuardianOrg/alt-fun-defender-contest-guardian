import { useState, useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { FeeVaultAbi } from "../contracts/abis";
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

  // Fees are pooled in `FeeVault`, so `claim()` drains the caller's entire
  // USDC balance in one call — no per-token targeting needed. The old
  // `tokenAddress` arg is gone; every button in the UI performs the same
  // single vault claim.
  const claim = useCallback(async () => {
    if (!address || !walletClient) return;
    const claimable = earningsQuery.data?.totalClaimable ?? 0;
    if (claimable <= 0) return;
    setClaiming(true);
    try {
      const hash = await walletClient.writeContract({
        address: ADDRESSES.feeVault,
        abi: FeeVaultAbi,
        functionName: "claim",
        args: [],
      });
      const receipt = await hyperEvmClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error("Claim transaction reverted on-chain");
      }
      earningsQuery.refetch();
    } finally {
      setClaiming(false);
    }
  }, [address, walletClient, earningsQuery]);

  return {
    earnings: earningsQuery.data,
    isLoading: earningsQuery.isLoading,
    isError: earningsQuery.isError,
    error: earningsQuery.error,
    claiming,
    claim,
  };
}
