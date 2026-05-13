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
 * Resolve a referral deeplink param to the referrer's rewards-wallet
 * address. Returns `null` when:
 *   - The username mapping has no entry (the referrer never ran /start
 *     under that handle).
 *   - The referrer has no active wallet (they have not onboarded — no
 *     retro-link by spec).
 *   - The api referral lookup fails (treated like "unset rewards
 *     wallet" — drop silently rather than wedging /start on a
 *     transient outage).
 *
 * The returned address is the referrer's *rewards wallet* as the api
 * reports it today — which defaults to the referrer's active custodial
 * wallet if they have not explicitly set one (see api/routes/bot/
 * referrals.ts `readRewardsWallet`). This is the address the bot will
 * pass as the `referrer` arg to `BotFeeRouter` on every trade the new
 * user makes, forever.
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

  const active = await wm.getActive(referrerUserId);
  if (!active) return null;

  const stats = await fetchBotReferralStats(env, active.address);
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
