import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";

import { hyperEVM } from "./chains";

export const wagmiConfig = createConfig({
  chains: [hyperEVM],
  transports: {
    [hyperEVM.id]: http(import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm"),
  },
});
