import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";

import { hyperEVM } from "./chains";

export const wagmiConfig = createConfig({
  chains: [hyperEVM],
  transports: {
    // `batch: true` coalesces every read scheduled in the same microtask
    // (e.g. wagmi's parallel `useReadContract` reads, viem's `Promise.all`
    // of `readContract` calls) into a single JSON-RPC batch request, so
    // 3–5 `eth_call`s land as one HTTP POST. Defaults to `batchSize: 1000,
    // wait: 0` which is what we want — no artificial latency, just request
    // coalescing on the natural microtask boundary. Mirror this option on
    // every standalone `createPublicClient` in the app so the savings
    // apply outside wagmi too.
    [hyperEVM.id]: http(
      import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
      { batch: true },
    ),
  },
});
