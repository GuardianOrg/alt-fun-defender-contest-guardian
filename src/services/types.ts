import type { UnderlyingAsset, Leverage } from '@/config/constants';

export type Direction = 'long' | 'short';

export type TokenStatus = 'active' | 'graduating' | 'graduated';

export interface Token {
  address: string;
  name: string;
  ticker: string;
  emoji: string;
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
  side: 'BUY' | 'SELL';
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

export type TokenFilter = 'trending' | 'new' | 'lt-movers' | 'graduating' | 'all';

export interface CreateTokenParams {
  name: string;
  ticker: string;
  description: string;
  direction: Direction;
  underlying: UnderlyingAsset;
  leverage: Leverage;
  imageFile?: File;
  seedBuyUsd?: number;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

export interface TradeEstimate {
  tokensReceived: string;
  priceImpact: string;
  fee: string;
  total: string;
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

/**
 * Represents the user-facing transaction flow.
 *
 * All trades settle in USDC — the TX Router handles LT mint/redeem atomically.
 * Users never hold or interact with Leveraged Tokens directly.
 *
 * BUY flow:  approve USDC → Router.buy() → receive memecoin
 * SELL flow: approve memecoin → Router.sell() → receive USDC
 * CREATE:    approve USDC (seed) → Factory.createToken() → receive memecoin + curve deployed
 */
export interface TxContext {
  /** What the user is approving (USDC for buy/create, memecoin for sell) */
  approvalToken: 'USDC' | 'memecoin';
  /** The spender contract getting the approval (always the Router or Factory) */
  spender: 'router' | 'factory';
  /** Referral code for the Bounce Referral Module */
  referralCode: `0x${string}`;
}
