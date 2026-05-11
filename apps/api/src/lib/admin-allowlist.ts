import {
  DEFAULT_ADMIN_WALLETS,
  isAdminWallet,
  isValidAddressFormat,
} from "@launchpad/shared";

import type { AppBindings } from "./types.js";

/**
 * Resolves the active admin allowlist for the request. Order:
 *
 *   1. `env.ADMIN_WALLETS` (comma-separated, whitespace tolerated) wins
 *      when it parses to *at least one* validly-formatted Ethereum
 *      address. Lets ops add/remove an admin via `wrangler secret put`
 *      without a code review cycle (issue #586). Malformed entries
 *      (typos, missing `0x`, wrong length) are dropped silently — the
 *      override is only honoured if at least one address survives, so
 *      a typo in the binding can't lock everyone out.
 *   2. `DEFAULT_ADMIN_WALLETS` from `@launchpad/shared` is the fallback
 *      so the feature works out of the box on a fresh worker.
 *
 * The list is intentionally short and human-curated — Alt Fun moderation
 * is a few-people-with-keys operation, not a role-based access system.
 */
export function getAdminWallets(env: AppBindings): readonly string[] {
  const raw = env.ADMIN_WALLETS;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter(isValidAddressFormat);
    if (parsed.length > 0) return parsed;
  }
  return DEFAULT_ADMIN_WALLETS;
}

export function isAdminFor(env: AppBindings, address: string | null | undefined): boolean {
  return isAdminWallet(address, getAdminWallets(env));
}
