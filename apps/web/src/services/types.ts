import type { Leverage, UnderlyingAsset } from "../config/constants";
import type { SupportedAsset, SupportedLeverage } from "@launchpad/shared";

export type Direction = "long" | "short";

export type TokenStatus = "active" | "graduating" | "graduated";

export interface Token {
  address: string;
  name: string;
  ticker: string;
  emoji: string;
  image?: string;
  description: string;
  direction: Direction;
  underlying: UnderlyingAsset;
  leverage: Leverage;
  ltName: string;
  mcapUsd: number;
  change24h: number;
  buyMomentum: number;
  leverageBoost: number;
  curveFilled: number;
  curveRaisedUsd: number;
  volume24h: number;
  athUsd: number;
  status: TokenStatus;
  creatorAddress: string;
  createdAt: string;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

export interface Trade {
  id: string;
  side: "BUY" | "SELL";
  amountUsd: number;
  tokensAmount: string;
  walletAddress: string;
  timestamp: string;
  tokenAddress: string;
  tokenName: string;
}

export interface Asset {
  name: UnderlyingAsset;
  priceUsd: string;
  change24h: number;
}

export interface Holder {
  rank: number;
  address: string;
  tokens: string;
  percentSupply: number;
  isCreator: boolean;
}

export interface Comment {
  id: string;
  emoji: string;
  address: string;
  timeAgo: string;
  text: string;
}

export interface PlatformStats {
  tokensLive: number;
  graduating: number;
  volume24h: string;
  graduatedToday: number;
  totalRaised: string;
}

export interface PairFilter {
  asset: UnderlyingAsset;
  direction: Direction;
  count: number;
  color: string;
}

export type TokenFilter =
  | "trending"
  | "new"
  | "lt-movers"
  | "graduating"
  | "graduated"
  | "all";

export interface CreateTokenParams {
  name: string;
  ticker: string;
  description: string;
  direction: Direction;
  underlying: SupportedAsset;
  leverage: SupportedLeverage;
  imageFile?: File;
  seedBuyUsd: number;
  socialLinks?: string[];
}

export interface HeldToken {
  address: string;
  name: string;
  ticker: string;
  emoji: string;
  ltName: string;
  status: TokenStatus;
  amount: number;
  valueUsd: number;
  change24h: number;
}

export interface CreatedToken {
  address: string;
  name: string;
  emoji: string;
  ltName: string;
  status: TokenStatus;
  curveFilled: number;
  totalVolumeUsd: number;
  feesEarnedUsd: number;
  feesClaimableUsd: number;
}

export interface CreatorEarnings {
  totalEarned: number;
  totalClaimable: number;
  totalClaimed: number;
  tokens: CreatedToken[];
}

