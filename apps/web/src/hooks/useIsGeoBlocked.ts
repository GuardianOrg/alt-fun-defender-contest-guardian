import { useCallback } from "react";

import { useQuery } from "@tanstack/react-query";

// Default blocked country codes; GB is blocked for FCA-promotion reasons.
const DEFAULT_BLOCKED: readonly string[] = [
  "BY",
  "CU",
  "IR",
  "KP",
  "SY",
  "RU",
  "GB",
  "US",
];

const STALE_MS = 5 * 60 * 1000;
const GC_MS = 15 * 60 * 1000;

// Cloudflare request-introspection endpoint; absent under `vite dev`.
const TRACE_URL = "/cdn-cgi/trace";

// Dev override for exercising geo-block UI without a Cloudflare edge.
const OVERRIDE =
  (import.meta.env.VITE_GEO_COUNTRY_OVERRIDE ?? "").toUpperCase() || null;

function parseLoc(body: string): string | null {
  for (const line of body.split("\n")) {
    const [key, value] = line.split("=");
    if (key === "loc" && value) return value.trim().toUpperCase();
  }
  return null;
}

async function fetchCountry(): Promise<string | null> {
  if (OVERRIDE) return OVERRIDE;
  // Avoid stale country after VPN changes.
  const res = await fetch(TRACE_URL, { cache: "no-store" });
  if (!res.ok) return null;
  return parseLoc(await res.text());
}

/** CDN-derived, fail-open geo gate with a manual recheck escape hatch. */
export function useIsGeoBlocked(
  blockedCountries: readonly string[] = DEFAULT_BLOCKED,
): {
  isGeoBlocked: boolean;
  country: string | null;
  isLoading: boolean;
  recheck: () => Promise<void>;
} {
  const query = useQuery({
    queryKey: ["geo", "cf-trace"],
    queryFn: fetchCountry,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  });

  const country = query.data ?? null;
  const isGeoBlocked = country !== null && blockedCountries.includes(country);

  const recheck = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return { isGeoBlocked, country, isLoading: query.isLoading, recheck };
}
