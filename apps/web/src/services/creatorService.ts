import { BondingAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http } from "viem";

import { API_BASE, fetchTokens } from "./api";
import { hyperEVM } from "../config/chains";
import { ADDRESSES } from "../contracts/addresses";

import type { CreatorEarnings } from "./types";

const publicClient = createPublicClient({
  chain: hyperEVM,
  transport: http(),
});

export interface ICreatorService {
  getEarnings(walletAddress: string): Promise<CreatorEarnings | null>;
  claimEarnings(
    walletAddress: string,
    tokenAddress?: string,
  ): Promise<string>;
}

const liveCreatorService: ICreatorService = {
  async getEarnings(walletAddress) {
    try {
      const tokens = await fetchTokens(100);
      const createdTokens = tokens.filter(
        (t) => t.creator.toLowerCase() === walletAddress.toLowerCase(),
      );

      if (createdTokens.length === 0) return null;

      // `ltPair` is already indexed in Postgres, so we skip the previous
      // `tokenInfo` multicall and go straight to `creatorFees(creator, lt)`.
      const creatorFeeCalls = createdTokens.map((token) => ({
        address: ADDRESSES.bonding,
        abi: BondingAbi,
        functionName: "creatorFees" as const,
        args: [walletAddress as `0x${string}`, token.ltPair as `0x${string}`],
      }));

      const feeResults = await publicClient.multicall({
        contracts: creatorFeeCalls,
        allowFailure: true,
      });

      let totalClaimable = 0;
      const tokenEarnings = createdTokens.map((token, i) => {
        const feeResult = feeResults[i];
        const claimableUsd =
          feeResult.status === "success"
            ? parseFloat(formatUnits(feeResult.result as bigint, 18))
            : 0;
        totalClaimable += claimableUsd;

        return {
          address: token.address,
          name: token.name,
          imageUrl: token.imageUrl ? new URL(token.imageUrl, API_BASE).toString() : undefined,
          ltName: `${token.ltPair} ${token.leverage}×`,
          ltAddress: token.ltPair,
          status: "active" as const,
          curveFilled: token.curveFilled ?? null,
          totalVolumeUsd: 0,
          feesEarnedUsd: claimableUsd,
          feesClaimableUsd: claimableUsd,
        };
      });

      return {
        totalEarned: totalClaimable,
        totalClaimable,
        totalClaimed: 0,
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
