import { createConfig, http } from "wagmi";

import { hyperEVM } from "./chains";

export const wagmiConfig = createConfig({
  // @ts-expect-error — viem type mismatch between root viem and @privy-io/react-auth's bundled viem under TypeScript 6.0
  chains: [hyperEVM],
  transports: {
    [hyperEVM.id]: http(import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm"),
  },
});
