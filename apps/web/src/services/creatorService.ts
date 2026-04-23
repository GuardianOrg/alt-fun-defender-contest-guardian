import { FeeVaultAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http } from "viem";

import { API_BASE, fetchTokenEarnings, fetchTokens } from "./api";
import { hyperEVM } from "../config/chains";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";

import type { CreatorEarnings } from "./types";

const publicClient = createPublicClient({
  chain: hyperEVM,
  transport: http(),
});

export interface ICreatorService {
  getEarnings(walletAddress: string): Promise<CreatorEarnings | null>;
  claimEarnings(walletAddress: string): Promise<string>;
}

const liveCreatorService: ICreatorService = {
  async getEarnings(walletAddress) {
    try {
      const tokens = await fetchTokens(100);
      const createdTokens = tokens.filter(
        (t) => t.creator.toLowerCase() === walletAddress.toLowerCase(),
      );

      // Fees are pooled at the `FeeVault` level — a single USDC balance per
      // creator covers every token they've launched. One read, not N.
      const [claimableRaw, lifetimeRaw] = await Promise.all([
        publicClient.readContract({
          address: ADDRESSES.feeVault,
          abi: FeeVaultAbi,
          functionName: "creatorBalance",
          args: [walletAddress as `0x${string}`],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ADDRESSES.feeVault,
          abi: FeeVaultAbi,
          functionName: "lifetimeCreatorEarned",
          args: [walletAddress as `0x${string}`],
        }) as Promise<bigint>,
      ]);

      const totalClaimable = parseFloat(formatUnits(claimableRaw, USDC_DECIMALS));
      const totalEarned = parseFloat(formatUnits(lifetimeRaw, USDC_DECIMALS));
      // Claim events aren't tracked on the vault's state (balances reset on
      // `claim`), so we derive claimed = lifetime earned − currently claimable.
      // Clamp at 0 so block-time ordering quirks never show a negative.
      const totalClaimed = Math.max(0, totalEarned - totalClaimable);

      if (createdTokens.length === 0) {
        return totalEarned > 0 || totalClaimable > 0
          ? { totalEarned, totalClaimable, totalClaimed, tokens: [] }
          : null;
      }

      // Per-token earned figures come from the indexer (aggregated
      // `FeeAccrued.creatorAmount`), since the vault doesn't itself
      // attribute balances back to individual tokens.
      const perTokenEarnings = await Promise.all(
        createdTokens.map(async (token) => {
          try {
            return await fetchTokenEarnings(token.address);
          } catch {
            return null;
          }
        }),
      );

      const tokenEarnings = createdTokens.map((token, i) => {
        const feesEarnedUsd = perTokenEarnings[i]?.creatorFeesUsd ?? 0;
        return {
          address: token.address,
          name: token.name,
          imageUrl: token.imageUrl
            ? new URL(token.imageUrl, API_BASE).toString()
            : undefined,
          ltName: `${token.ltPair} ${token.leverage}×`,
          ltAddress: token.ltPair,
          status: "active" as const,
          curveFilled: token.curveFilled ?? null,
          // See docs on `ApiToken.totalVolumeUsd`: `null` means indexer is
          // degraded, `0` means the column exists but the token has never
          // traded. `formatUsd` needs a number, so coerce to 0 here.
          totalVolumeUsd: token.totalVolumeUsd ?? 0,
          feesEarnedUsd,
          // Per-token "claimable" is not meaningful in the pooled model —
          // creators always claim the whole vault balance. Kept for UI
          // compatibility but zero; the page uses `totalClaimable` instead.
          feesClaimableUsd: 0,
        };
      });

      return {
        totalEarned,
        totalClaimable,
        totalClaimed,
        tokens: tokenEarnings,
      };
    } catch {
      return null;
    }
  },

  async claimEarnings() {
    throw new Error("Use useCreatorEarnings hook for on-chain claims");
  },
};

export const creatorService: ICreatorService = liveCreatorService;
