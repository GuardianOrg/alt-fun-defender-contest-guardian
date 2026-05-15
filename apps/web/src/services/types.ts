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
  /** Live USD value of the curve's real LT reserve (`realLt × currentRate`).
   *  Numerator behind `curveFilled`; powers the `$X raised` label on the
   *  curve strip. Null when the breakdown is degraded (indexer/BounceTech
   *  down) or post-graduation — render as `—` via `formatUsdOrDash`. */
  curveRaisedUsd: number | null;
  /**
   * 24h USD trading volume (buys + sells through `Zap`). `null`
   * while the indexer aggregation is degraded — render as `—`, never `$0`.
   */
  volume24h: number | null;
  /**
   * Lifetime gross USD traded through `Zap` for this token
   * (buys + sells, never subtracts). Tracked as a running counter on the
   * indexer so it survives pagination truncation. `null` only when the
   * indexer is unreachable.
   */
  totalVolumeUsd: number | null;
  athUsd: number;
  /** Current price/mcap/24h change served by the API. Null while indexer or
   *  BounceTech is degraded — callers must treat null as "unknown", never 0. */
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  status: TokenStatus;
  creatorAddress: string;
  createdAt: string;
  /**
   * `true` when the token has been hidden from the public listings by an
   * admin (issue #586). When `isHidden` is true the page is only
   * reachable by a connected wallet that holds the token — the API's
   * `/tokens/:address?wallet=…` endpoint refuses to disclose hidden rows
   * to non-holders (issue #712). Drives the policy-violation disclaimer
   * banner and disables every buy path; sells stay open so holders can
   * exit their position cleanly.
   */
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
  /** Absolute USD price change over the trailing 24h window
   *  (`currentMid - 24hAgoOpen`). Same sign as `change24h`. */
  priceChange24h: number;
}

export interface Holder {
  rank: number;
  address: string;
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
  /**
   * `true` when the held token has been admin-hidden. The position keeps
   * surfacing in the holder's "My Positions" panel (issue #712), but
   * the row is rendered with a policy-violation marker so the user
   * knows their only path forward is to sell.
   */
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

