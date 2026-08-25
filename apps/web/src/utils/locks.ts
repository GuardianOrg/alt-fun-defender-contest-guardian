import type { ApiTokenLock } from "../services/api";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/** Index locks by lowercased token address. Absent ⇒ token has no active lock. */
export function indexTokenLocks(
  locks: ApiTokenLock[],
): Map<string, ApiTokenLock> {
  return new Map(locks.map((l) => [l.tokenAddress.toLowerCase(), l]));
}

/** `null` for an unparseable timestamp so callers can drop the date entirely. */
export function formatUnlockDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, DATE_FORMAT);
}

/**
 * Percentage shown on the pill and repeated in its claim.
 *
 * A lock small enough to round to zero still exists, and `0% LOCKED` reads as
 * a broken number rather than a small one — the API omits unlocked tokens
 * entirely, so any percentage that reaches here is nonzero by construction.
 */
export function formatLockPercent(percent: number): string {
  const rounded = Math.round(percent);
  return rounded === 0 ? "<1%" : `${rounded}%`;
}

/**
 * The full claim behind the `75% LOCKED` pill, used as both its `title` and
 * its `aria-label`.
 *
 * Naming the denominator is the whole point. "75% locked" on its own reads as
 * a statement about circulating supply, which it isn't — it's a share of the
 * fixed 1B initial supply, the same basis the holders table's `% Supply`
 * column uses. Since `title` reaches neither touch devices nor screen
 * readers, this sentence has to live on `aria-label` too.
 *
 * "Fully released by", not "until": `unlocksAt` is the *latest* cliff across
 * every lock on the token, so when a token has several locks with different
 * cliffs only part of the total is still locked at that date. "Locked until
 * X" would assert the whole percentage survives to X, which over-states
 * safety — the one direction this feature must never fail in. The wording
 * here is true whether the token has one lock or five.
 */
export function lockClaim(percent: number, unlocksAt: string): string {
  const date = formatUnlockDate(unlocksAt);
  const base = `${formatLockPercent(percent)} of the 1B initial supply is locked in Sablier`;
  return date ? `${base}, fully released by ${date}` : base;
}
