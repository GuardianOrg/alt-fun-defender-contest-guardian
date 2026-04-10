import { BondingAbi } from "@launchpad/shared";
import { createPublicClient, formatUnits, http } from "viem";


import { fetchTokens } from "./api";
import { erc20Abi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

import type { CreatorEarnings, HeldToken } from "./types";

const HYPER_EVM_RPC = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";

const publicClient = createPublicClient({
  transport: http(HYPER_EVM_RPC),
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
      const balances: HeldToken[] = [];

      for (const token of tokens) {
        try {
          const balance = (await publicClient.readContract({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress as `0x${string}`],
          })) as bigint;

          if (balance > 0n) {
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
        } catch {
          /* skip on error */
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

      let totalClaimable = 0;
      const tokenEarnings = [];

      for (const token of createdTokens) {
        try {
          const info = (await publicClient.readContract({
            address: ADDRESSES.bonding,
            abi: BondingAbi,
            functionName: "tokenInfo",
            args: [token.address as `0x${string}`],
          })) as readonly [string, string, string, string, string, string, boolean, boolean];
          const ltAddress = info[3] as `0x${string}`;

          const claimable = (await publicClient.readContract({
            address: ADDRESSES.bonding,
            abi: BondingAbi,
            functionName: "creatorFees",
            args: [walletAddress as `0x${string}`, ltAddress],
          })) as bigint;

          const claimableUsd = parseFloat(formatUnits(claimable, 18));
          totalClaimable += claimableUsd;

          tokenEarnings.push({
            address: token.address,
            name: token.name,
            emoji: "",
            ltName: `${token.ltPair} ${token.leverage}×`,
            status: "active" as const,
            curveFilled: 0,
            totalVolumeUsd: 0,
            feesEarnedUsd: claimableUsd,
            feesClaimableUsd: claimableUsd,
          });
        } catch {
          tokenEarnings.push({
            address: token.address,
            name: token.name,
            emoji: "",
            ltName: `${token.ltPair} ${token.leverage}×`,
            status: "active" as const,
            curveFilled: 0,
            totalVolumeUsd: 0,
            feesEarnedUsd: 0,
            feesClaimableUsd: 0,
          });
        }
      }

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

  async claimEarnings(_walletAddress, _tokenAddress) {
    return "0x";
  },
};

export const creatorService: ICreatorService = liveCreatorService;
