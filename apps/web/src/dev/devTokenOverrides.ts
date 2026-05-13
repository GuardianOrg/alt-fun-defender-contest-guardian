import type { Token, TokenStatus } from "../services/types";

/**
 * Dev-only per-address overlay over the `useToken` cache. The
 * `DevSimulator` panel writes into this store so a developer can flip a
 * token between `active` / `graduating` / `graduated` and slide its
 * `curveFilled` independent of what the API actually returns — handy
 * for QAing the curve strip, the ProgressBar's fill-driven glow, the
 * graduation overlay, and the lifecycle pills without having to wait
 * on real on-chain progress.
 *
 * The overlay is applied **outside** the TanStack Query cache (in
 * `useToken`'s post-fetch transform) rather than mutating the cache,
 * so:
 *   - WS-driven invalidations (`useTokenLiveFeed`) keep refreshing real
 *     data underneath without clobbering the override on every tick.
 *   - Clearing the override snaps back to the real API response on the
 *     next render — no need to refetch.
 *   - Other consumers of the same query key (`["token", addr, wallet]`)
 *     stay unaffected, since the override is layered per-call.
 *
 * Production builds: every read of this module is gated behind
 * `import.meta.env.DEV`. The bundler dead-code-eliminates the
 * `applyTokenOverride` call in `useToken` on `vite build`, and there is
 * no production code path that writes into the store.
 */

export interface TokenOverride {
  /** Lifecycle override; undefined leaves the API value untouched. */
  status?: TokenStatus;
  /**
   * Forced bonding-curve fill (0–100). Applied to both `curveFilled`
   * and the organic/boost split (proportionally to whatever ratio the
   * real API response had — or 100% organic when the API value is
   * `null` / 0). Ignored when `status === "graduated"` because the
   * graduated branch collapses the bar to a single solid amber fill in
   * `ProgressBar.tsx`, and the fill % stops being meaningful.
   */
  curveFilledPercent?: number;
}

type Listener = () => void;

// Address-keyed map. Lowercased keys so a `0xABC…` URL param and a
// `0xabc…` API response collide on the same entry — the WS / API
// layers already case-fold addresses, so the override layer must too.
const overrides = new Map<string, TokenOverride>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const cb of listeners) cb();
}

function key(address: string): string {
  return address.toLowerCase();
}

export function getTokenOverride(
  address: string | undefined,
): TokenOverride | undefined {
  if (!address) return undefined;
  return overrides.get(key(address));
}

export function setTokenOverride(
  address: string,
  patch: TokenOverride,
): void {
  const existing = overrides.get(key(address)) ?? {};
  overrides.set(key(address), { ...existing, ...patch });
  notify();
}

export function clearTokenOverride(address: string): void {
  if (overrides.delete(key(address))) notify();
}

/**
 * Subscribe to any change in the override map. The callback fires once
 * per mutation (set / clear), regardless of which address changed —
 * `useSyncExternalStore` consumers re-read their own slice on each
 * notification and React skips the render when the slice is referentially
 * stable, so a global listener fan-out is the simplest correct shape.
 */
export function subscribeTokenOverrides(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Pure transform: apply an override to a `Token` and return the merged
 * value (or the original reference when nothing changes). Returns the
 * original `token` ref when `override` is undefined / empty so React's
 * referential-equality short-circuit in downstream `useMemo` /
 * `React.memo` keeps working.
 *
 * The split between `organicFilled` and `leverageBoost` is preserved
 * proportionally to the real API ratio so a slider drag still produces
 * a visually realistic two-segment bar (instead of always collapsing
 * to "all organic"). When the API value was null / zero / degraded we
 * fall back to "all organic", matching how the bar renders a degraded
 * token in production (single solid fill).
 */
export function applyTokenOverride(
  token: Token,
  override: TokenOverride | undefined,
): Token {
  if (!override) return token;
  const hasStatus = override.status !== undefined;
  const hasFill = override.curveFilledPercent !== undefined;
  if (!hasStatus && !hasFill) return token;

  const status = hasStatus ? override.status! : token.status;

  // Curve fill is meaningless once graduated (the bar collapses to a
  // solid amber 100% per `ProgressBar.tsx`), so we only re-derive the
  // split when staying on the curve. The slider in the dev panel is
  // hidden in the graduated branch for the same reason — see
  // `DevSimulator.tsx`.
  let curveFilled = token.curveFilled;
  let organicFilled = token.organicFilled;
  let leverageBoost = token.leverageBoost;

  if (hasFill && status !== "graduated") {
    const next = Math.max(0, Math.min(100, override.curveFilledPercent!));
    curveFilled = next;
    const realCurve = token.curveFilled ?? 0;
    const realOrganic = token.organicFilled ?? null;
    if (realOrganic === null || realCurve <= 0) {
      // Degraded API or fresh token — all-organic matches the
      // `organicFilled === null` rendering rule in `apps/web/AGENTS.md`
      // (single solid fill, no implied "all boost").
      organicFilled = next;
      leverageBoost = 0;
    } else {
      const organicShare = realOrganic / realCurve;
      organicFilled = next * organicShare;
      leverageBoost = next - organicFilled;
    }
  }

  return {
    ...token,
    status,
    curveFilled,
    organicFilled,
    leverageBoost,
  };
}
