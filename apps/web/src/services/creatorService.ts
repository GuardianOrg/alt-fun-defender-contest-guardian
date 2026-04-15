import { BondingAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http } from "viem";

import { fetchTokens } from "./api";
import { hyperEVM } from "../config/chains";
import { erc20Abi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

import type { CreatorEarnings, HeldToken } from "./types";

const publicClient = createPublicClient({
  chain: hyperEVM,
  transport: http(),
});

export interface ICreatorService {
  getBalances(walletAddress: string): Promise<HeldToken[]>;
  getEarnings(walletAddress: string): Promise<CreatorEarnings | null>;
  claimEarnings(
    walletAddress: string,
    tokenAddress?: string,
  ): Promise<string>;
}

const liveCreatorService: ICreatorService = {
  async getBalances(walletAddress) {
    try {
      const tokens = await fetchTokens(100);
      if (tokens.length === 0) return [];

      const balanceCalls = tokens.map((token) => ({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [walletAddress as `0x${string}`],
      }));

      const results = await publicClient.multicall({
        contracts: balanceCalls,
        allowFailure: true,
      });

      const balances: HeldToken[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const result = results[i];
        if (result.status === "success") {
          const balance = result.result as bigint;
          if (balance > 0n) {
            const token = tokens[i];
            balances.push({
              address: token.address,
              name: token.name,
              ticker: token.ticker,
              emoji: "",
              ltName: `${token.ltPair} ${token.leverage}×`,
              status: "active",
              amount: parseFloat(formatUnits(balance, 18)),
              valueUsd: 0,
              change24h: 0,
            });
          }
        }
      }
      return balances;
    } catch {
      return [];
    }
  },

  async getEarnings(walletAddress) {
    try {
      const tokens = await fetchTokens(100);
      const createdTokens = tokens.filter(
        (t) => t.creator.toLowerCase() === walletAddress.toLowerCase(),
      );

      if (createdTokens.length === 0) return null;

      // Batch all tokenInfo calls into a single multicall
      const tokenInfoCalls = createdTokens.map((token) => ({
        address: ADDRESSES.bonding,
        abi: BondingAbi,
        functionName: "tokenInfo" as const,
        args: [token.address as `0x${string}`],
      }));

      const tokenInfoResults = await publicClient.multicall({
        contracts: tokenInfoCalls,
        allowFailure: true,
      });

      // Build creatorFees calls using LT addresses from tokenInfo results
      const creatorFeeCalls = tokenInfoResults.map((infoResult, i) => {
        if (infoResult.status === "success") {
          const info = infoResult.result as readonly [string, string, string, string, string, string, boolean, boolean];
          const ltAddress = info[3] as `0x${string}`;
          return {
            address: ADDRESSES.bonding,
            abi: BondingAbi,
            functionName: "creatorFees" as const,
            args: [walletAddress as `0x${string}`, ltAddress],
          };
        }
        // Placeholder call for failed tokenInfo — will also fail, handled below
        return {
          address: ADDRESSES.bonding,
          abi: BondingAbi,
          functionName: "creatorFees" as const,
          args: [walletAddress as `0x${string}`, createdTokens[i].address as `0x${string}`],
        };
      });

      const feeResults = await publicClient.multicall({
        contracts: creatorFeeCalls,
        allowFailure: true,
      });

      let totalClaimable = 0;
      const tokenEarnings = createdTokens.map((token, i) => {
        const feeResult = feeResults[i];
        if (tokenInfoResults[i].status === "success" && feeResult.status === "success") {
          const claimable = feeResult.result as bigint;
          const claimableUsd = parseFloat(formatUnits(claimable, 18));
          totalClaimable += claimableUsd;

          return {
            address: token.address,
            name: token.name,
            emoji: "",
            ltName: `${token.ltPair} ${token.leverage}×`,
            status: "active" as const,
            curveFilled: 0,
            totalVolumeUsd: 0,
            feesEarnedUsd: claimableUsd,
            feesClaimableUsd: claimableUsd,
          };
        }

        return {
          address: token.address,
          name: token.name,
          emoji: "",
          ltName: `${token.ltPair} ${token.leverage}×`,
          status: "active" as const,
          curveFilled: 0,
          totalVolumeUsd: 0,
          feesEarnedUsd: 0,
          feesClaimableUsd: 0,
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
