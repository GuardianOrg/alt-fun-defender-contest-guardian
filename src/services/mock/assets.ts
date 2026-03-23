import type { Asset, PlatformStats, PairFilter } from "../types";

export const MOCK_ASSETS: Asset[] = [
  { name: "HYPE", priceUsd: "$18.42", change24h: 8.2 },
  { name: "ETH", priceUsd: "$2,041", change24h: -3.1 },
  { name: "SOL", priceUsd: "$122", change24h: -5.8 },
  { name: "BTC", priceUsd: "$82,400", change24h: 1.4 },
];

export const MOCK_ASSET_DATA: Record<
  string,
  { chg: number; nav2: number; nav3: number }
> = {
  HYPE: { chg: 8.2, nav2: 36.84, nav3: 55.26 },
  ETH: { chg: -3.1, nav2: 4082, nav3: 6123 },
  BTC: { chg: 1.4, nav2: 164800, nav3: 247200 },
  SOL: { chg: -5.8, nav2: 244, nav3: 366 },
  ARB: { chg: -1.2, nav2: 1.64, nav3: 2.46 },
  OP: { chg: 2.6, nav2: 3.24, nav3: 4.86 },
};

export const MOCK_PLATFORM_STATS: PlatformStats = {
  tokensLive: 20,
  graduating: 2,
  volume24h: "$184K",
  graduatedToday: 3,
  totalRaised: "$142K",
};

export const MOCK_PAIR_FILTERS: PairFilter[] = [
  { asset: "HYPE", direction: "long", count: 8, color: "#4de8b4" },
  { asset: "ETH", direction: "short", count: 4, color: "#6ef0c2" },
  { asset: "SOL", direction: "short", count: 4, color: "#9fe0cb" },
  { asset: "BTC", direction: "long", count: 4, color: "#f0b429" },
];
