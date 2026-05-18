import { useCallback } from "react";

import { useQuery } from "@tanstack/react-query";

/**
 * Default blocked country codes (ISO 3166-1 alpha-2).
 *
 * - `BY`, `CU`, `IR`, `KP`, `SY`, `RU` — comprehensive-sanctions jurisdictions
 *   we cannot legally serve (OFAC-style allowlist).
 * - `GB` — blocked separately on FCA-promotion grounds, not sanctions.
 *
 * Override per-call if a future surface needs a different policy.
 */
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

/**
 * Cloudflare exposes a plaintext request-introspection endpoint at the
 * site's own origin. It returns lines like `loc=US`, `ip=...`, etc., where
 * `loc` is the ISO country derived from the edge POP that terminated the
 * request. Same-origin → no CORS, no extra config — works for free on
 * every Cloudflare Pages deploy.
 *
 * **Does not exist on `vite dev`.** Localhost has no Cloudflare edge in
 * front of it; the dev server SPA-falls back to `index.html` (200 OK with
 * HTML body), `parseLoc` finds no `loc=` line, and the hook reports
 * `country: null`. Use `VITE_GEO_COUNTRY_OVERRIDE` (below) to simulate
 * a country in dev.
 */
const TRACE_URL = "/cdn-cgi/trace";

/**
 * Dev-only escape hatch: if set (e.g. `VITE_GEO_COUNTRY_OVERRIDE=GB` in
 * `.env.local`) the hook skips the trace fetch entirely and reports this
 * country. Lets you exercise the geo-block banner against `vite dev`
 * without standing up a Cloudflare-fronted preview. Vite inlines this at
 * build time, so a production bundle without the env var set has zero
 * runtime cost and zero behaviour change.
 */
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
  // `no-store` is critical — without it the browser (or an intermediate
  // proxy) can serve a stale country after the user toggles a VPN, which
  // defeats the whole point of the `recheck()` escape hatch below.
  const res = await fetch(TRACE_URL, { cache: "no-store" });
  if (!res.ok) return null;
  return parseLoc(await res.text());
}

/**
 * CDN-derived geo-blocking. Uses Cloudflare's `/cdn-cgi/trace` to read the
 * country the request was terminated from, then matches it against
 * `blockedCountries`.
 *
 * **Fail-open while loading or on error.** A trace fetch that 404s (running
 * `vite dev` off-Cloudflare), times out, or returns no `loc` line yields
 * `country: null` and `isGeoBlocked: false`. This is intentional — a
 * moderation-style block belongs at the API/contract layer; this hook is
 * only the cosmetic edge gate. Consumers that care about uncertainty
 * should branch on `isLoading` themselves.
 *
 * **VPN re-check escape hatch.** `recheck()` invalidates the cached trace
 * and refetches; consumers can wire it to a "I'm not in the US" button so
 * a user who just connected to a non-blocked region doesn't have to
 * hard-reload the page to clear the gate.
 */
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
