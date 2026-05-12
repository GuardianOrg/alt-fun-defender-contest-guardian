/**
 * Default moderation admin allowlist baked into the codebase.
 *
 * Addresses listed here can sign wallet messages to hide / unhide tokens
 * from the public Alt Fun front-end. The list is intentionally small and
 * hardcoded — adding or removing an admin is a code change + redeploy.
 *
 * In environments where short-lived overrides are needed (e.g. rotating
 * a compromised key without waiting on a code review cycle) the API
 * Worker also reads `ADMIN_WALLETS` (comma-separated checksum or
 * lowercase addresses) and uses that *in place of* this list when set.
 * See `apps/api/src/lib/admin-allowlist.ts`.
 */
export const DEFAULT_ADMIN_WALLETS = [
  "0xef126Ea643fC8940D9D6634DCd07F3989963Fbe6",
  "0x6D0D39aD22689eBfe8Cd5010a97E1b5458B231Cb",
] as const;

/** Matches a 0x-prefixed 40-hex-character Ethereum address. */
const ETHEREUM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidAddressFormat(value: unknown): value is string {
  return typeof value === "string" && ETHEREUM_ADDRESS_REGEX.test(value.trim());
}

/**
 * Lowercase address comparison helper. Both halves are validated as
 * `0x`-prefixed hex addresses first — anything that fails the format
 * check (typo, empty string, non-string, malformed allowlist entry) is
 * skipped without throwing. Returns `false` for any input that doesn't
 * normalise to a valid address; callers don't need to validate first.
 */
export function isAdminWallet(
  address: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (!isValidAddressFormat(address)) return false;
  const target = address.trim().toLowerCase();
  for (const candidate of allowlist) {
    if (!isValidAddressFormat(candidate)) continue;
    if (candidate.trim().toLowerCase() === target) return true;
  }
  return false;
}
