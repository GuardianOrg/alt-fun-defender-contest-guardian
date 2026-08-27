import { createPublicClient, fallback, http } from "viem";

import { hyperEVM } from "./chains";

const PUBLIC_RPC = "https://rpc.hyperliquid.xyz/evm";

/** Alchemy flakes under receipt polling; public RPC is the fallback. */
export function hyperEvmTransport() {
  const primary = import.meta.env.VITE_RPC_URL || PUBLIC_RPC;
  const batched = { batch: true } as const;
  if (primary === PUBLIC_RPC) return http(primary, batched);
  return fallback([http(primary, batched), http(PUBLIC_RPC, batched)]);
}

export const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: hyperEvmTransport(),
});
