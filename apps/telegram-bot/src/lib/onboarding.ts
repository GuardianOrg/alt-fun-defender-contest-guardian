import type { Address } from "viem";
import { isAddress } from "viem";

import { fetchBotReferralStats, setBotRewardsWallet } from "./api.js";
import { logger } from "./logger.js";
import type { Env } from "./types.js";
import type { WalletManager } from "./wallet.js";

/**
 * Telegram username syntax (BotFather rules): 5-32 chars from
 * `[A-Za-z0-9_]`. Same regex used by `commands/referral.ts` when
 * minting outbound deeplinks; centralising here would create a cycle,
 * so the pattern is duplicated.
 */
const TELEGRAM_USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;

export interface UserProfile {
  createdAt: number;
  /**
   * Resolved rewards-wallet address of the referrer who onboarded
   * this user, captured at first /start. Lifetime + immutable — the
   * /start handler refuses to overwrite this once set, and downstream
   * trade flows pass this address as the `referrer` arg to
   * `BotFeeRouter.{buy,sell}WithBotFee`. `null` means no valid
   * deeplink was present (or the referrer had not yet onboarded), in
   * which case trades pass `address(0)` and no referral cut accrues.
   */
  referrer: Address | null;
  /**
   * Stable wallet identity used when *this* user appears as a
   * referrer to someone else. Set at first /start = the initial
   * custodial wallet address. Immutable thereafter — independent of
   * `setActive` flips and of later `createWallet` / `importWallet`
   * calls. Two surfaces depend on this being stable:
   *
   *   1. `/referral` — the rewards-wallet KV record (`rewards-wallet:
   *      {wallet}` in the api) is keyed by this address, so the
   *      user's referral stats and rewards-wallet config follow their
   *      identity across wallet switches instead of forking onto a
   *      fresh identity every time they flip active.
   *   2. `resolveReferrer` at deeplink-click time — a new user
   *      tapping `ref_<userId>` always lands on the same referrer
   *      identity, not whichever wallet the referrer happens to have
   *      active in that moment.
   *
   * Optional in the type so legacy profiles written before this field
   * existed still parse — `getReferralIdentityWallet` lazily backfills
   * via the user's current active wallet the first time it runs.
   */
  referralIdentityWallet?: Address;
}

const profileKey = (userId: number): string => `profile:${userId}`;
const usernameKey = (lower: string): string => `tg-username:${lower}`;

export type StartParam =
  | { kind: "userId"; userId: number }
  | { kind: "username"; username: string };

/**
 * Parse the `/start <param>` argument. Returns `null` for anything
 * that is not a `ref_*` referral deeplink — non-ref params have no
 * meaning in v1, and silently ignoring them is preferable to misrouting
 * into the referral resolver.
 */
export const parseStartParam = (raw: string | undefined): StartParam | null => {
  const arg = raw?.trim();
  if (!arg) return null;
  if (!arg.startsWith("ref_")) return null;
  const body = arg.slice("ref_".length);
  if (!body) return null;
  if (/^[0-9]+$/.test(body)) {
    const n = Number(body);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    return { kind: "userId", userId: n };
  }
  if (TELEGRAM_USERNAME_RE.test(body)) {
    return { kind: "username", username: body };
  }
  return null;
};

/**
 * Action deeplink payload — `buy_<addr>` / `sell_<addr>` / `track_<addr>`
 * — emitted by the inline links on each open position in `/positions`.
 * Tapping the link returns the user to the bot chat and fires
 * `/start <payload>`, which the start handler routes to a fresh
 * buy / sell / track card for the selected token.
 *
 * Kept separate from `parseStartParam` so the referral resolver path
 * never sees an action payload and vice versa.
 */
export type ActionStartParam = {
  action: "buy" | "sell" | "track";
  token: Address;
};

export const parseActionStartParam = (
  raw: string | undefined,
): ActionStartParam | null => {
  const arg = raw?.trim();
  if (!arg) return null;
  const sep = arg.indexOf("_");
  if (sep <= 0) return null;
  const prefix = arg.slice(0, sep);
  const body = arg.slice(sep + 1);
  if (prefix !== "buy" && prefix !== "sell" && prefix !== "track") return null;
  if (!isAddress(body, { strict: false })) return null;
  return { action: prefix, token: body.toLowerCase() as Address };
};

export const readProfile = async (
  kv: KVNamespace,
  userId: number,
): Promise<UserProfile | null> => {
  const raw = await kv.get(profileKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UserProfile;
    if (typeof parsed.createdAt !== "number") return null;
    if (parsed.referrer !== null && !isAddress(parsed.referrer, { strict: false })) {
      return null;
    }
    // `referralIdentityWallet` is optional (legacy profiles predate it).
    // When present it must be a valid address; a malformed value drops
    // the whole profile rather than silently falling back, since the
    // alternative is divergent identity between the on-disk record and
    // the lazy backfill on next read.
    if (
      parsed.referralIdentityWallet !== undefined &&
      !isAddress(parsed.referralIdentityWallet, { strict: false })
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writeProfile = async (
  kv: KVNamespace,
  userId: number,
  profile: UserProfile,
): Promise<void> => {
  await kv.put(profileKey(userId), JSON.stringify(profile));
};

/**
 * Write the `username → userId` mapping used by `resolveReferrer` when
 * a deeplink arrives in the `ref_<username>` form. Re-runs on every
 * /start so a user who later sets / changes their Telegram handle
 * (handle changes invalidate the old mapping but not the userId) gets
 * picked up without a manual migration. No-op when the user has no
 * username, since Telegram usernames are optional.
 */
export const recordUsername = async (
  kv: KVNamespace,
  username: string | undefined,
  userId: number,
): Promise<void> => {
  const trimmed = username?.trim();
  if (!trimmed || !TELEGRAM_USERNAME_RE.test(trimmed)) return;
  await kv.put(usernameKey(trimmed.toLowerCase()), String(userId));
};

const readUserIdForUsername = async (
  kv: KVNamespace,
  username: string,
): Promise<number | null> => {
  const raw = await kv.get(usernameKey(username.toLowerCase()));
  if (!raw) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Return the user's stable referral-identity wallet — the address that
 * keys their `/referral` rewards-wallet record and that every referee
 * deeplinks resolve through. Returns `null` when the user has no
 * active wallet at all (never ran /start).
 *
 * For profiles written under the new schema, this is just
 * `profile.referralIdentityWallet`. For legacy profiles missing the
 * field, the helper backfills lazily using the user's current active
 * wallet and persists the result — making subsequent reads stable
 * even if the user flips `setActive` afterwards. The backfill is
 * best-effort: a KV write failure does not surface here, since the
 * fallback path still returns a valid address for *this* call and the
 * next call simply repeats the backfill.
 */
export const getReferralIdentityWallet = async (
  env: Env,
  wm: WalletManager,
  userId: number,
): Promise<Address | null> => {
  const profile = await readProfile(env.WALLET_KV, userId);
  if (profile?.referralIdentityWallet) {
    return profile.referralIdentityWallet.toLowerCase() as Address;
  }
  const active = await wm.getActive(userId);
  if (!active) return null;
  const identity = active.address.toLowerCase() as Address;
  if (profile !== null) {
    try {
      await writeProfile(env.WALLET_KV, userId, {
        ...profile,
        referralIdentityWallet: identity,
      });
    } catch (err) {
      logger.warn("getReferralIdentityWallet: backfill write failed", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return identity;
};

/**
 * Resolve a referral deeplink param to the referrer's rewards-wallet
 * address. Returns `null` when:
 *   - The username mapping has no entry (the referrer never ran /start
 *     under that handle).
 *   - The referrer has no resolvable identity wallet (they have not
 *     onboarded — no retro-link by spec).
 *   - The api referral lookup fails (treated like "unset rewards
 *     wallet" — drop silently rather than wedging /start on a
 *     transient outage).
 *
 * The lookup keys off `getReferralIdentityWallet`, not the referrer's
 * currently-active wallet — otherwise a referrer who flipped
 * `setActive` between sharing their link and the click would route
 * the new attribution onto a fresh wallet's (empty) KV record. The
 * returned address is the referrer's *rewards wallet* as the api
 * reports it — which defaults to the identity wallet itself if no
 * explicit override has been set (see api/routes/bot/referrals.ts
 * `readRewardsWallet`). This is the address the bot passes as the
 * `referrer` arg to `BotFeeRouter` on every trade the new user makes,
 * forever.
 */
export const resolveReferrer = async (
  env: Env,
  wm: WalletManager,
  param: StartParam,
): Promise<Address | null> => {
  const referrerUserId =
    param.kind === "userId"
      ? param.userId
      : await readUserIdForUsername(env.WALLET_KV, param.username);
  if (referrerUserId === null) return null;

  const identity = await getReferralIdentityWallet(env, wm, referrerUserId);
  if (!identity) return null;

  const stats = await fetchBotReferralStats(env, identity);
  if (!stats.ok) {
    logger.warn("resolveReferrer: fetchBotReferralStats failed", {
      referrerUserId,
      kind: stats.kind,
    });
    return null;
  }
  const rewardsWallet = stats.data.rewardsWallet;
  if (!isAddress(rewardsWallet, { strict: false })) return null;
  return rewardsWallet.toLowerCase() as Address;
};

/**
 * POST the user's default rewards wallet to the api on first /start so
 * `/referral` and on-chain attribution have a concrete address from
 * day one. Failures are logged + swallowed: the api defaults
 * `rewardsWallet` to the wallet address itself when no record is
 * present (see api `readRewardsWallet`), so the user-visible
 * /referral surface stays correct even if this write loses to a
 * transient outage. A later /referral "Change rewards wallet" wizard
 * call will re-establish the record.
 */
export const writeDefaultRewardsWallet = async (
  env: Env,
  wallet: Address,
): Promise<void> => {
  const res = await setBotRewardsWallet(env, wallet, wallet);
  if (!res.ok) {
    logger.warn("writeDefaultRewardsWallet failed", {
      wallet,
      kind: res.kind,
    });
  }
};
