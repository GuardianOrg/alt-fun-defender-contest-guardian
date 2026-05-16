import { useState, useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { FeeVaultAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";
import { creatorService } from "../services/creatorService";

const rpcUrl =
  import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

// Poll cadence for the rewards card. Fees accrue on every trade through
// `Zap`, so a static "load on mount + load on claim" view goes stale
// the instant a creator's bonding curve sees activity — but the hook
// is mounted unconditionally on every page that renders
// `EarningsPanel`, `ProfileView`, or `CreatorBadge`, so a tight cadence
// fans out fast across the catalogue.
//
// The vault-totals fetch is now a single `GET /api/v1/creators/
// :wallet/earnings` call backed by an indexer primary-key lookup
// (edge-cached for 15s), replacing the legacy two `eth_call`s against
// `FeeVault.creatorBalance` / `lifetimeCreatorEarned`. The per-token
// list still walks `/api/v1/tokens?creator=…` — bounded to one
// wallet's tokens by the server-side `creator` filter (issue #476).
//
// 30s aligns with `/market-data`'s edge-cache TTL — the slowest other
// recurring fetch on the same surfaces — and matches the worst-case
// freshness a creator can reasonably tolerate for "I just got a wave
// of trades, when will my claimable balance update?". A 30s poll on
// top of the 15s API edge cache means worst-case staleness is ~45s
// (and almost always <30s in practice once the SWR window kicks in).
// Combined with TanStack Query's tab-hidden auto-pause, a
// backgrounded earnings panel costs zero. User-driven refreshes
// (open the panel, land a claim tx) still run instantly via the
// explicit `refetch()` paths that already wire
// `useCreatorEarnings.refetch` into the claim flow.
const REFETCH_INTERVAL_MS = 30_000;

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
    refetch: earningsQuery.refetch,
  };
}
