import {
  BondingAbi,
  CONTRACT_ADDRESSES,
  DEFAULT_GRADUATION_THRESHOLD_USD,
  HYPER_EVM,
} from "@launchpad/shared";
import { createPublicClient, http } from "viem";

import type { AppBindings } from "./types.js";

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

/**
 * Live read of `Bonding.graduationThresholdUsd`. The threshold is set once
 * at proxy initialisation and has no on-chain setter — see
 * `packages/contracts/src/Bonding.sol`. We still read it via RPC (rather
 * than hardcoding the deploy-time value) so that:
 *
 *   1. A future UUPS upgrade that bumps the value via `reinitializer` is
 *      picked up automatically without a webapp redeploy.
 *   2. Different deployments (mainnet, testnet, local fork) can ship with
 *      different thresholds and the API just reflects whatever the proxy
 *      reports.
 *
 * Cached per Worker isolate. The TTL is generous because the value is
 * effectively immutable; the cache only refreshes after a Worker isolate
 * has been alive for `CACHE_TTL_MS`.
 *
 * If the RPC is unreachable, callers see the compile-time default
 * (`DEFAULT_GRADUATION_THRESHOLD_USD`). This keeps the curve-filled bar
 * populated during RPC outages instead of degrading to "unknown" — the
 * value matches the production deploy.
 */

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: number;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/**
 * Returns the graduation threshold in plain USD (e.g. `12000`). Falls
 * back to the compile-time default on RPC error.
 *
 * Cached per Worker isolate for `CACHE_TTL_MS`.
 */
export async function getGraduationThresholdUsd(
  env: AppBindings,
): Promise<number> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const fetched = await fetchFromRpc(env);
  const value = fetched ?? DEFAULT_GRADUATION_THRESHOLD_USD;
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Test-only hook to drop the per-isolate cache between cases. */
export function _resetGraduationThresholdCache(): void {
  cache = null;
}

async function fetchFromRpc(env: AppBindings): Promise<number | null> {
  try {
    const transport = http(env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl);
    const client = createPublicClient({ chain, transport });
    const wei = (await client.readContract({
      address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
      abi: BondingAbi,
      functionName: "graduationThresholdUsd",
    })) as bigint;
    // 18-dp wei → plain USD. Production thresholds sit in $4K–$1M, well
    // within JS Number precision.
    return Number(wei / 10n ** 18n);
  } catch {
    return null;
  }
}
