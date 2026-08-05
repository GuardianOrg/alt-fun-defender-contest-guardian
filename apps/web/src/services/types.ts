import type { Leverage, UnderlyingAsset } from "../config/constants";
import type { SupportedAsset, SupportedLeverage } from "@launchpad/shared";

export type { Trade, TradeBroadcast } from "@launchpad/shared";

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
  /** LT contract address (Postgres-sourced; never requires an RPC lookup). */
  ltAddress: string;
  buyMomentum: number;
  /** Share of `curveFilled` attributable to LT price appreciation, clamped at 0. */
  leverageBoost: number;
  /** Organic-buy share of `curveFilled`; null when breakdown is unknown. */
  organicFilled: number | null;
  /** Bonding curve progress; null means unknown, never 0. */
  curveFilled: number | null;
  /** Live USD value of the curve's real LT reserve; null degraded/post-grad. */
  curveRaisedUsd: number | null;
  /** 24h USD trading volume through `Zap`; null while aggregation is degraded. */
  volume24h: number | null;
  /** Lifetime gross USD traded through `Zap`; null only when indexer is unreachable. */
  totalVolumeUsd: number | null;
  athUsd: number;
  /** Current price; null means unknown, never 0. */
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  status: TokenStatus;
  creatorAddress: string;
  /** ISO timestamp of a community takeover; null when the original creator remains. */
  communityTakeoverAt: string | null;
  createdAt: string;
  /** Admin-hidden; holders can still view/sell, but public buy paths are disabled. */
  isHidden: boolean;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

export interface Asset {
  name: UnderlyingAsset;
  priceUsd: string;
  /** Percent change over the trailing 24h window (e.g. `1.23` = +1.23%). */
  change24h: number;
  /** Absolute USD price change over the trailing 24h window. */
  priceChange24h: number;
}

export interface Holder {
  rank: number;
  /** Shortened wallet address for in-row display (e.g. `0x12…78`). */
  address: string;
  /** Full 0x-prefixed wallet address for links/copy. */
  walletFull: string;
  tokens: string;
  percentSupply: number;
  isCreator: boolean;
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
  | "graduating"
  | "graduated";

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
  /** Token logo URL (R2-served). `undefined` falls back to the emoji. */
  image?: string;
  ltName: string;
  status: TokenStatus;
  amount: number;
  valueUsd: number;
  change24h: number | null;
  /** Hidden positions still surface to holders so they can sell. */
  isHidden: boolean;
}

export interface CreatedToken {
  address: string;
  name: string;
  ticker: string;
  imageUrl?: string;
  ltName: string;
  ltAddress: string;
  status: TokenStatus;
  curveFilled: number | null;
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

