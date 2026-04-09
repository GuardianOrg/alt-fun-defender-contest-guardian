export type TokenStatus = "curve" | "graduating" | "graduated";

export type TradeType = "buy" | "sell";

export interface Token {
  address: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  ltPair: string;
  ltDirection: "long" | "short";
  leverage: number;
  creator: string;
  status: TokenStatus;
  marketCap: number;
  marketCapUsd: number;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  curveFilled: number;
  curveTarget: number;
  createdAt: number;
}

export interface Trade {
  txHash: string;
  tokenAddress: string;
  trader: string;
  type: TradeType;
  amountUsd: number;
  tokenAmount: number;
  priceUsd: number;
  timestamp: number;
}

export interface Creator {
  address: string;
  tokensCreated: number;
  totalEarnings: number;
  totalVolume: number;
}
