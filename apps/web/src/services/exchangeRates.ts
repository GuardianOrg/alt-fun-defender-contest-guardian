import {
  BOUNCE_INDEXING_API,
  type LiveLeveragedToken,
} from "@launchpad/shared";
import { formatUnits } from "viem";

import { fetchPonderToken } from "./ponder";

// LT address → exchange rate (USD per LT, as a float)
let ltRateCache = new Map<string, number>();
let ltRateCacheTime = 0;
const LT_RATE_CACHE_TTL = 60_000;

export async function getLtExchangeRates(): Promise<Map<string, number>> {
  if (Date.now() - ltRateCacheTime < LT_RATE_CACHE_TTL && ltRateCache.size > 0) {
    return ltRateCache;
  }
  const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`);
  const json = (await res.json()) as { data: LiveLeveragedToken[] };
  const lts = json.data;
  const rates = new Map<string, number>();
  for (const lt of lts) {
    rates.set(lt.address.toLowerCase(), parseFloat(formatUnits(BigInt(lt.exchangeRate), 18)));
  }
  ltRateCache = rates;
  ltRateCacheTime = Date.now();
  return rates;
}

// tokenAddress → ltAddress (lowercase)
const tokenLtMap = new Map<string, string>();

async function getLtAddressForToken(tokenAddress: string): Promise<string | undefined> {
  const key = tokenAddress.toLowerCase();
  const cached = tokenLtMap.get(key);
  if (cached) return cached;

  const token = await fetchPonderToken(tokenAddress);
  if (token) {
    const ltAddr = token.ltToken.toLowerCase();
    tokenLtMap.set(key, ltAddr);
    return ltAddr;
  }
  return undefined;
}

export async function resolveExchangeRate(tokenAddress: string): Promise<number> {
  const [rates, ltAddr] = await Promise.all([
    getLtExchangeRates(),
    getLtAddressForToken(tokenAddress),
  ]);
  if (ltAddr) {
    return rates.get(ltAddr) ?? 1;
  }
  return 1;
}
