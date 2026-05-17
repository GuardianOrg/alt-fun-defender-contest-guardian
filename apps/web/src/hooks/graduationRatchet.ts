import type { Token } from "../services/types";

/**
 * Sticky "this token has graduated" registry.
 *
 * Graduation is a strictly one-way contract-level transition:
 * `Bonding.TokenGraduated` has no inverse, the LP is locked, and the
 * curve is dismantled — there's no on-chain path back to `status:
 * "curve"`. Any API response that downgrades a previously-graduated
 * token is therefore a *transient data error*, not a real lifecycle
 * change. The most common source is `apps/api/src/routes/tokens/detail.ts`
 * defaulting `graduated = onchain?.graduated ?? false` whenever Ponder /
 * BounceTech are unreachable (`marketResult.ok === false`); a single
 * such response landing through a WS-driven invalidation
 * (`useGraduationFeed`, `useTokenLiveFeed`) is enough to flash the
 * curve strip back to an empty bar before the next refetch recovers.
 *
 * The ratchet sits at the boundary between TanStack Query and the
 * components: once `useToken` (or any consumer that runs `Token`
 * payloads through `applyGraduationRatchet`) has observed a token in
 * `status: "graduated"`, every subsequent payload for that address is
 * pinned to graduated regardless of what the API says.
 *
 * Persisted in `sessionStorage` so a hard reload during a degraded
 * window doesn't lose the ratchet state for tokens we'd already seen
 * graduated. We deliberately use `sessionStorage` rather than
 * `localStorage`: a stale entry that somehow outlived the page (e.g.
 * QA copy-pastes a fixture address that was graduated yesterday) is
 * naturally evicted when the tab closes, so we never serve a wrong
 * "graduated" lens for a token that genuinely never graduated.
 */

const STORAGE_KEY = "altfun.graduatedRatchet.v1";

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Some sandboxed contexts (private mode in older Safari, embedded
    // webviews) throw on the `sessionStorage` getter itself. Treat as
    // "no persistence" — the in-memory set still works fine.
    return null;
  }
}

function loadInitial(): Set<string> {
  const storage = getSessionStorage();
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((v): v is string => typeof v === "string" && v.length > 0),
    );
  } catch {
    return new Set();
  }
}

const graduatedAddresses = loadInitial();

function persist(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(graduatedAddresses)),
    );
  } catch {
    // Storage full / disabled mid-session. The in-memory set still
    // protects the rest of this page lifecycle, so we just swallow.
  }
}

function normalize(address: string): string {
  return address.toLowerCase();
}

/**
 * Mark `address` as graduated. Idempotent — repeat calls for the
 * same address skip the storage write.
 */
export function markGraduated(address: string): void {
  const key = normalize(address);
  if (graduatedAddresses.has(key)) return;
  graduatedAddresses.add(key);
  persist();
}

/**
 * Whether we've seen `address` in `status: "graduated"` at any point
 * during this session (or a session that previously persisted to
 * `sessionStorage` for this tab).
 */
export function isKnownGraduated(address: string | undefined): boolean {
  if (!address) return false;
  return graduatedAddresses.has(normalize(address));
}

/**
 * Test-only escape hatch. Production code never resets the ratchet —
 * graduation is permanent — so this exists purely so unit tests can
 * start each case from a clean slate without leaking into the next.
 */
export function _resetGraduationRatchetForTesting(): void {
  graduatedAddresses.clear();
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Match the swallow-on-failure policy of the persist path.
    }
  }
}

/**
 * Pure transform: pin `token.status` to `"graduated"` if either
 *
 *   - the incoming token already reports `status: "graduated"` (in
 *     which case we also seed the ratchet for future responses), or
 *   - we've previously observed this address in `status: "graduated"`
 *     and the current response has slipped back to a pre-grad state
 *     (typically because the API hit its degraded path).
 *
 * Returns the original `token` reference when no change is needed so
 * downstream `useMemo` / `React.memo` referential checks keep working
 * (matches the pattern in `applyTokenOverride`).
 *
 * The fix is intentionally minimal — we only flip `status`, not the
 * curve fill / breakdown / `curveRaisedUsd` etc. The detail view
 * (`TokenDetailView.tsx`) and the row card (`TokenRow.tsx`) both
 * recompute their visuals off `status === "graduated"` (collapsing
 * the bar to a solid 100% fill, hiding the threshold label, etc.),
 * so pinning `status` is enough to suppress the empty-state flash
 * without us having to recreate the API's post-grad enrichment shape.
 */
export function applyGraduationRatchet(token: Token): Token {
  if (token.status === "graduated") {
    markGraduated(token.address);
    return token;
  }
  if (!isKnownGraduated(token.address)) return token;
  return { ...token, status: "graduated" };
}
