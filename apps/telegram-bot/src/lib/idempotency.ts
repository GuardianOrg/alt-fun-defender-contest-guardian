/**
 * KV-backed commit-log for trade transactions.
 *
 * The Confirm flow already stages a one-shot nonce in `ctx.session.pendingTrade`
 * and clears it in-memory before `executeBuy`/`executeSell` runs, so a duplicate
 * Confirm tap within the same DO turn is a no-op. That layer is sufficient
 * against stale UI clicks but NOT against submission retries: if Telegram
 * retries the webhook before grammY's session write commits to KV — which can
 * happen when `sendTransaction` returns slowly, the receipt-wait blocks the
 * Worker, or the DO turn is killed before middleware finishes — the second
 * invocation reads the stale session, sees `pendingTrade` still set, and
 * re-submits an on-chain tx. With real USDC, that is a double-spend.
 *
 * The fix is a persistent commit-log written **before** `sendTransaction`. We
 * key it on `(userId, nonce)` so every staged intent has a stable, globally
 * unique idempotency key. The first executor:
 *
 *   1. atomically `claim`s the slot in KV (status: "submitting");
 *   2. submits the on-chain tx and records the hash (status: "submitted");
 *   3. on receipt, records the final outcome (status: "completed" | "failed").
 *
 * A retry — same `(userId, nonce)` — sees the existing record and returns the
 * recorded result instead of submitting a second tx. Even if the retry lands
 * between steps 1 and 2 (we have no hash yet), it bails with an `in_progress`
 * result rather than firing a duplicate tx; the user can check the explorer or
 * retry the trade after the TTL window.
 *
 * TTL is generous (1 hour) so a retry that arrives well after the original
 * still dedupes. Telegram's retry window is far shorter than this in practice.
 */

import type { Hash } from "viem";

/** Cloudflare KV's runtime put options. `expirationTtl` is the only one we use. */
interface KVPutOptions {
  expirationTtl?: number;
}

/**
 * Subset of `KVNamespace` we depend on. Modeling against the runtime shape
 * (not `@cloudflare/workers-types`) keeps the in-memory test KV compatible
 * without a type cast at every call site.
 */
export interface IdempotencyKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KVPutOptions): Promise<void>;
}

/** Status of a recorded trade attempt. */
export type IntentStatus =
  | "submitting"
  | "submitted"
  | "completed"
  | "failed";

/**
 * Serialised execution outcome. Mirrors `ExecutionResult` in `trade.ts` but
 * with `bigint` fields encoded as strings so the record round-trips through
 * JSON. We never store the private key, slippage, or other inputs — only the
 * tx hash and the user-visible result.
 */
export interface IntentResult {
  ok: boolean;
  /** Failure taxonomy from `ExecutionResult`. Only present on `ok: false`. */
  kind?:
    | "not_configured"
    | "reverted"
    | "unavailable"
    | "insufficient_funds"
    | "pending";
  reason?: string;
  txHash?: Hash;
  /** Quoted-out amount in raw units, decimal string. Present on `ok: true`. */
  quotedOut?: string;
  /** Slippage-floored minimum-out in raw units, decimal string. Present on `ok: true`. */
  minOut?: string;
  /**
   * Actual tokens received on a confirmed buy, raw 18-dp decimal string.
   * Decoded from the `BotRouterTrade` log on the original receipt and
   * persisted so a webhook-retry that reads the existing record renders
   * the same "received N tokens" line the first attempt produced.
   */
  actualTokensOut?: string;
  /**
   * Actual net USDC received on a confirmed sell, raw 6-dp decimal
   * string (`usdcAmount - botFee` from the `BotRouterTrade` log).
   * Persisted so a webhook-retry renders the same "received $X USDC"
   * line the first attempt produced.
   */
  actualUsdcOut?: string;
}

export interface IntentRecord {
  status: IntentStatus;
  txHash?: Hash;
  result?: IntentResult;
  /** ms epoch when the slot was claimed; debug-only. */
  claimedAt: number;
}

/**
 * Lifetime of a commit-log entry. One hour is far longer than Telegram's
 * webhook-retry horizon (minutes), short enough that the KV namespace doesn't
 * accumulate state from abandoned flows.
 */
export const INTENT_TTL_SECONDS = 60 * 60;

/** Build the KV key for a given user + nonce. */
export const intentKey = (userId: number, nonce: string): string =>
  `txintent:${userId}:${nonce}`;

const parseRecord = (raw: string): IntentRecord | null => {
  try {
    const parsed = JSON.parse(raw) as IntentRecord;
    if (typeof parsed?.status !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
};

/** Read the current commit-log record for an intent, or `null` if none. */
export const readIntent = async (
  kv: IdempotencyKv,
  key: string,
): Promise<IntentRecord | null> => {
  const raw = await kv.get(key);
  if (raw === null) return null;
  return parseRecord(raw);
};

export type ClaimOutcome =
  | { kind: "claimed" }
  | { kind: "duplicate"; record: IntentRecord };

/**
 * Try to take ownership of an intent slot. The check-then-write is not a true
 * compare-and-swap, but the layer above (`ChatDO`) serialises updates per
 * chat, and the nonce — minted by `stageBuy` / `stageSell` — never escapes
 * that single chat's update stream. So in the only execution model where the
 * key can be touched twice (retry of the same DO turn), the second caller
 * waits behind the first in the DO queue and always observes the first's
 * write before its own read. Cross-chat collisions are impossible because the
 * nonce is freshly minted, never shared.
 */
export const claimIntent = async (
  kv: IdempotencyKv,
  key: string,
): Promise<ClaimOutcome> => {
  const existing = await readIntent(kv, key);
  if (existing !== null) return { kind: "duplicate", record: existing };
  const record: IntentRecord = {
    status: "submitting",
    claimedAt: Date.now(),
  };
  await kv.put(key, JSON.stringify(record), {
    expirationTtl: INTENT_TTL_SECONDS,
  });
  return { kind: "claimed" };
};

/** Record the tx hash as soon as `sendTransaction` returns it. */
export const markSubmitted = async (
  kv: IdempotencyKv,
  key: string,
  txHash: Hash,
): Promise<void> => {
  const record: IntentRecord = {
    status: "submitted",
    txHash,
    claimedAt: Date.now(),
  };
  await kv.put(key, JSON.stringify(record), {
    expirationTtl: INTENT_TTL_SECONDS,
  });
};

/** Record the receipt outcome (success or revert) so retries can read it back. */
export const markFinal = async (
  kv: IdempotencyKv,
  key: string,
  result: IntentResult,
): Promise<void> => {
  const record: IntentRecord = {
    status: result.ok ? "completed" : "failed",
    txHash: result.txHash,
    result,
    claimedAt: Date.now(),
  };
  await kv.put(key, JSON.stringify(record), {
    expirationTtl: INTENT_TTL_SECONDS,
  });
};
