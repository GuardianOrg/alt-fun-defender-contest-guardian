import { DEFAULT_GRADUATION_THRESHOLD_USD } from "@launchpad/shared";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";

import { hyperEVM } from "../config/chains";
import { BondingAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

const STALE_MS = 5 * 60 * 1000;
const GC_MS = 30 * 60 * 1000;

/**
 * Live `Bonding.graduationThresholdUsd` (owner-tunable). Returns plain USD
 * (e.g. `12000`), not 18-dp wei. Cached aggressively (5min stale, 30min gc)
 * because this only changes on an admin tx and a stale value just delays the
 * UI seeing a parameter tweak by a few minutes — not user-facing critical.
 *
 * `data` is `undefined` while loading and on RPC failure (TanStack Query
 * catches the throw). Consumers should treat `undefined` as "unknown" and
 * either render a skeleton or fall back to `DEFAULT_GRADUATION_THRESHOLD_USD`
 * for non-critical display (text labels) — never hardcode 12_000 inline.
 */
export function useGraduationThreshold(): {
  data: number | undefined;
  isLoading: boolean;
  /** Compile-time fallback for callers that need a number unconditionally. */
  fallback: number;
} {
  const query = useQuery({
    queryKey: ["graduationThresholdUsd", ADDRESSES.bonding],
    queryFn: async (): Promise<number> => {
      const wei = (await hyperEvmClient.readContract({
        address: ADDRESSES.bonding,
        abi: BondingAbi,
        functionName: "graduationThresholdUsd",
      })) as bigint;
      // 18-dp → plain USD. Live values sit in $4K–$1M (contract bounds), so
      // fits a JS Number with no precision concerns.
      return Number(wei / 10n ** 18n);
    },
    staleTime: STALE_MS,
    gcTime: GC_MS,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    fallback: DEFAULT_GRADUATION_THRESHOLD_USD,
  };
}
