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

// Poll cadence for the rewards card. Fees accrue on every trade through
// `Zap`, so a static "load on mount + load on claim" view goes stale the
// instant a creator's bonding curve sees activity. 5s is the product
// floor from issue #454 (sibling cadence to holders #452 and volume
// #453) and is cheap: one cached `/api/v1/tokens` hit (Worker-edge
// cached) plus two `eth_call`s against `FeeVault`.
const REFETCH_INTERVAL_MS = 5_000;

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
    // `refetchInterval` is paused automatically while the tab is hidden
    // (TanStack Query default), so a backgrounded earnings panel does not
    // burn RPC quota.
    refetchInterval: REFETCH_INTERVAL_MS,
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
