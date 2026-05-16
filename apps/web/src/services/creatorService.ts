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
      // Pooled vault totals come from the indexer-backed
      // `GET /api/v1/creators/:address/earnings` endpoint — one HTTP
      // call replaces the prior two `eth_call`s against
      // `FeeVault.creatorBalance` / `lifetimeCreatorEarned` per 30s
      // poll per mounted earnings/profile/creator-badge page. Server-
      // side `creator` filter on the per-token list pushes the lookup
      // into Postgres so we only paginate this wallet's tokens, not the
      // full catalogue (issue #476). The two reads are independent —
      // fetch them in parallel.
      const [createdTokens, vaultEarnings] = await Promise.all([
        fetchAllTokens({ creator: walletAddress }),
        fetchCreatorEarnings(walletAddress),
      ]);

      // Direct mapping — endpoint already runs the floor at zero and the
      // float conversion server-side (using the precision-aware
      // `usdcRawToUsd` split); see `apps/api/src/routes/creators.ts`.
      const totalEarned = vaultEarnings.lifetimeEarnedUsd;
      const totalClaimable = vaultEarnings.claimableUsd;
      const totalClaimed = vaultEarnings.lifetimeClaimedUsd;

      if (createdTokens.length === 0) {
        return totalEarned > 0 || totalClaimable > 0
          ? { totalEarned, totalClaimable, totalClaimed, tokens: [] }
          : null;
      }

      // Per-token earned figures ride along on the existing tokens response
      // (the API derives them from a running counter on the indexer's
      // `token` row, bumped on every `FeeVault:FeeAccrued`). One API call
      // for the whole list — no per-token fan-out, no pagination ceiling
      // on the per-token sum.
      const tokenEarnings = createdTokens.map((token) => ({
        address: token.address,
        name: token.name,
        ticker: token.ticker,
        // Empty `imageUrl` means the creator skipped image upload at
        // launch — substitute the public default art so the rewards /
        // transfer-ownership rows match the home-page list rendering
        // for the same token. See `DEFAULT_TOKEN_IMAGE`.
        imageUrl: token.imageUrl
          ? new URL(token.imageUrl, API_BASE).toString()
          : DEFAULT_TOKEN_IMAGE,
        ltName: `${token.ltPair} ${token.leverage}×`,
        ltAddress: token.ltPair,
        status: "active" as const,
        curveFilled: token.curveFilled ?? null,
        // See docs on `ApiToken.totalVolumeUsd` / `creatorFeesUsd`: `null`
        // means indexer is degraded, `0` means the column exists but the
        // token has never traded / accrued. `formatUsd` needs a number, so
        // coerce to 0 here for both.
        totalVolumeUsd: token.totalVolumeUsd ?? 0,
        feesEarnedUsd: token.creatorFeesUsd ?? 0,
        // Per-token "claimable" is not meaningful in the pooled model —
        // creators always claim the whole vault balance. Kept for UI
        // compatibility but zero; the page uses `totalClaimable` instead.
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
