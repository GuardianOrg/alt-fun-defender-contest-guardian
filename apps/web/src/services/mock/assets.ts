import { COLORS } from "../../config/colors";

import type { Asset, PlatformStats, PairFilter } from "../types";

export const MOCK_ASSETS: Asset[] = [
  { name: "HYPE", priceUsd: "$18.42", change24h: 8.2 },
  { name: "ETH", priceUsd: "$2,041", change24h: -3.1 },
  { name: "SOL", priceUsd: "$122", change24h: -5.8 },
  { name: "BTC", priceUsd: "$82,400", change24h: 1.4 },
];

export const MOCK_ASSET_DATA: Record<
  string,
  { change24h: number; nav2x: number; nav3x: number }
> = {
  HYPE: { change24h: 8.2, nav2x: 36.84, nav3x: 55.26 },
  ETH: { change24h: -3.1, nav2x: 4082, nav3x: 6123 },
  BTC: { change24h: 1.4, nav2x: 164800, nav3x: 247200 },
  SOL: { change24h: -5.8, nav2x: 244, nav3x: 366 },
  ARB: { change24h: -1.2, nav2x: 1.64, nav3x: 2.46 },
  OP: { change24h: 2.6, nav2x: 3.24, nav3x: 4.86 },
};

export const MOCK_PLATFORM_STATS: PlatformStats = {
  tokensLive: 20,
  graduating: 2,
  volume24h: "$184K",
  graduatedToday: 3,
  totalRaised: "$142K",
};

export const MOCK_PAIR_FILTERS: PairFilter[] = [
  { asset: "HYPE", direction: "long", count: 8, color: COLORS.mint },
  { asset: "ETH", direction: "short", count: 4, color: "#6ef0c2" },
  { asset: "SOL", direction: "short", count: 4, color: "#9fe0cb" },
  { asset: "BTC", direction: "long", count: 4, color: COLORS.amber },
];
