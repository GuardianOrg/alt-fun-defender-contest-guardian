import type { Token, TokenStatus } from "../services/types";

export interface TokenOverride {
  /** Lifecycle override; undefined leaves the API value untouched. */
  status?: TokenStatus;
  /** Forced bonding-curve fill (0-100), ignored after graduation. */
  curveFilledPercent?: number;
  /** Forced USD market cap for chart-overlay animation QA. */
  mcapUsd?: number;
}

type Listener = () => void;

// Lowercase keys match WS/API address folding.
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

/** Subscribe to any override mutation; consumers re-read their own address slice. */
export function subscribeTokenOverrides(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Apply dev override while preserving references when nothing changes. */
export function applyTokenOverride(
  token: Token,
  override: TokenOverride | undefined,
): Token {
  if (!override) return token;
  const hasStatus = override.status !== undefined;
  const hasFill = override.curveFilledPercent !== undefined;
  if (!hasStatus && !hasFill) return token;

  const status = hasStatus ? override.status! : token.status;

  // Curve fill is meaningless after graduation; the bar is forced to 100%.
  let curveFilled = token.curveFilled;
  let organicFilled = token.organicFilled;
  let leverageBoost = token.leverageBoost;

  if (hasFill && status !== "graduated") {
    const next = Math.max(0, Math.min(100, override.curveFilledPercent!));
    curveFilled = next;
    const realCurve = token.curveFilled ?? 0;
    const realOrganic = token.organicFilled ?? null;
    if (realOrganic === null || realCurve <= 0) {
      // Degraded/fresh tokens render as a single organic fill.
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
