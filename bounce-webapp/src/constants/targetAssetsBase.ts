// If you change this, check whether to update mintPersistConfig key in store.ts

export type Asset = "BTC" | "ETH" | "HYPE" | "SOL" | "PAXG";

export type AssetId = "hyperliquid" | "bitcoin" | "ethereum" | "solana" | "paxg";

export type TargetAssetBase = {
  id: AssetId;
  symbol: Asset;
  longLeverageOptions: number[];
  shortLeverageOptions: number[];
  accentColor: string;
  searchTerms: string[];
};

export const TARGET_ASSETS_BASE: TargetAssetBase[] = [
  {
    id: "hyperliquid",
    symbol: "HYPE",
    longLeverageOptions: [2, 3, 5],
    shortLeverageOptions: [1, 2, 3, 5],
    accentColor: "#9EF9E7",
    searchTerms: ["HYPE", "Hyperliquid"],
  },
  {
    id: "bitcoin",
    symbol: "BTC",
    longLeverageOptions: [2, 3, 5],
    shortLeverageOptions: [2, 3, 5],
    accentColor: "#FF9900",
    searchTerms: ["BTC", "Bitcoin"],
  },
  {
    id: "ethereum",
    symbol: "ETH",
    longLeverageOptions: [2, 3, 5],
    shortLeverageOptions: [2, 3, 5],
    accentColor: "#6882EB",
    searchTerms: ["ETH", "Ethereum"],
  },
  {
    id: "solana",
    symbol: "SOL",
    longLeverageOptions: [2, 3, 5],
    shortLeverageOptions: [2, 3, 5],
    accentColor: "#fff",
    searchTerms: ["SOL", "Solana"],
  },
  {
    id: "paxg",
    symbol: "PAXG",
    longLeverageOptions: [2, 3, 5],
    shortLeverageOptions: [2, 3, 5],
    accentColor: "#CCA728",
    searchTerms: ["PAXG", "Paxos Gold", "Gold"],
  },
];
