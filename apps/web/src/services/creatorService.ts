import { API_BASE, fetchAllTokens, fetchCreatorEarnings } from "./api";
import { DEFAULT_TOKEN_IMAGE } from "../config/constants";

import type { CreatorEarnings } from "./types";

export interface ICreatorService {
  getEarnings(walletAddress: string): Promise<CreatorEarnings | null>;
  claimEarnings(walletAddress: string): Promise<string>;
}

const liveCreatorService: ICreatorService = {
  async getEarnings(walletAddress) {
    try {
      // Fetch wallet-scoped tokens and pooled vault totals independently.
      const [createdTokens, vaultEarnings] = await Promise.all([
        fetchAllTokens({ creator: walletAddress }),
        fetchCreatorEarnings(walletAddress),
      ]);

      // Endpoint already floors at zero and converts raw USDC server-side.
      const totalEarned = vaultEarnings.lifetimeEarnedUsd;
      const totalClaimable = vaultEarnings.claimableUsd;
      const totalClaimed = vaultEarnings.lifetimeClaimedUsd;

      if (createdTokens.length === 0) {
        return totalEarned > 0 || totalClaimable > 0
          ? { totalEarned, totalClaimable, totalClaimed, tokens: [] }
          : null;
      }

      // Per-token earnings ride along on the token response; no fan-out needed.
      const tokenEarnings = createdTokens.map((token) => ({
        address: token.address,
        name: token.name,
        ticker: token.ticker,
        // Empty on-chain image gets the shared public fallback.
        imageUrl: token.imageUrl
          ? new URL(token.imageUrl, API_BASE).toString()
          : DEFAULT_TOKEN_IMAGE,
        ltName: `${token.ltPair} ${token.leverage}×`,
        ltAddress: token.ltPair,
        status: "active" as const,
        curveFilled: token.curveFilled ?? null,
        // Rewards UI formats numbers, so degraded nulls collapse to 0 here.
        totalVolumeUsd: token.totalVolumeUsd ?? 0,
        feesEarnedUsd: token.creatorFeesUsd ?? 0,
        // Per-token claimable is meaningless in the pooled vault model.
        feesClaimableUsd: 0,
      }));

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
