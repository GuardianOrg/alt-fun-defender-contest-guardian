// If you change this, check whether to update mintPersistConfig key in store.ts

export type Asset = "BTC" | "ETH" | "HYPE" | "SOL" | "PAXG";

export type TargetAssetType = {
  id: string;
  symbol: Asset;
  image: string;
  leverageOptions: number[];
  accentColor: string;
  searchTerms: string[];
};

import bitcoin from "../assets/logos/bitcoin.svg";
import ethereum from "../assets/logos/ethereum.svg";
import hyperliquid from "../assets/logos/hyperliquid.svg";
import paxg from "../assets/logos/paxg.svg";
import solana from "../assets/logos/solana.svg";

export const TARGET_ASSETS: TargetAssetType[] = [
  {
    id: "hyperliquid",
    symbol: "HYPE",
    image: hyperliquid,
    leverageOptions: [2, 3, 5],
    accentColor: "#9EF9E7",
    searchTerms: ["HYPE", "Hyperliquid"],
  },
  {
    id: "bitcoin",
    symbol: "BTC",
    image: bitcoin,
    leverageOptions: [2, 3, 5],
    accentColor: "#FF9900",
    searchTerms: ["BTC", "Bitcoin"],
  },
  {
    id: "ethereum",
    symbol: "ETH",
    image: ethereum,
    leverageOptions: [2, 3, 5],
    accentColor: "#6882EB",
    searchTerms: ["ETH", "Ethereum"],
  },
  {
    id: "solana",
    symbol: "SOL",
    image: solana,
    leverageOptions: [2, 3, 5],
    accentColor: "#fff",
    searchTerms: ["SOL", "Solana"],
  },
  {
    id: "paxg",
    symbol: "PAXG",
    image: paxg,
    leverageOptions: [2, 3, 5],
    accentColor: "#CCA728",
    searchTerms: ["PAXG", "Paxos Gold", "Gold"],
  },
];
