import { defineChain } from "viem";

export const hyperEVM = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm"],
    },
  },
  blockExplorers: {
    default: {
      name: "HyperEVM Explorer",
      url: "https://explorer.hyperliquid.xyz",
    },
  },
});
