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
  /** LT contract address (Postgres-sourced; never requires an RPC lookup). */
  ltAddress: string;
  buyMomentum: number;
  /**
   * Share of `curveFilled` (0–100) attributable to LT price appreciation
   * since the organic buys. `0` when unknown (e.g. indexer degraded) or when
   * the LT has dropped (product decision: we never show a negative boost).
   * See `apps/api/src/lib/token-enrich.ts` for the computation.
   */
  leverageBoost: number;
  /**
   * Share of `curveFilled` (0–100) attributable to organic USDC buys. `null`
   * when unknown — render the bar as a single solid fill in that case rather
   * than assuming 0 (which would incorrectly imply "all boost, no organic").
   */
  organicFilled: number | null;
  /** Bonding curve progress (0–100). Null when the indexer is degraded —
   *  callers must treat null as "unknown" and render a dash, never 0. */
  curveFilled: number | null;
  curveRaisedUsd: number;
  volume24h: number;
  athUsd: number;
  /** Current price/mcap/24h change served by the API. Null while indexer or
   *  BounceTech is degraded — callers must treat null as "unknown", never 0. */
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
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
  /**
   * Post-trade bonding curve state. Present on trades sourced from the WS
   * `trade` channel (indexer broadcast), absent on trades sourced from the
   * Ponder REST polling fallback. Used by `useChartData` to recompute the
   * curve ratio live for the chart — formatted as 1e18-scaled bigint strings
   * matching the on-chain representation.
   */
  curveSupply?: string;
  ltReserve?: string;
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
  change24h: number | null;
}

export interface CreatedToken {
  address: string;
  name: string;
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

