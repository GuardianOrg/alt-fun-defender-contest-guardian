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
 * The full claim behind the `75% LOCKED` pill, used as both its `title` and
 * its `aria-label`.
 *
 * Naming the denominator is the whole point. "75% locked" on its own reads as
 * a statement about circulating supply, which it isn't — it's a share of the
 * fixed 1B initial supply, the same basis the holders table's `% Supply`
 * column uses. Since `title` reaches neither touch devices nor screen
 * readers, this sentence has to live on `aria-label` too.
 */
export function lockClaim(percent: number, unlocksAt: string): string {
  const rounded = Math.round(percent);
  const date = formatUnlockDate(unlocksAt);
  const base = `${rounded}% of the 1B initial supply is locked in Sablier`;
  return date ? `${base} until ${date}` : base;
}
