/**
 * Background polling for pending trade receipts.
 *
 * `awaitReceipt` inside `executeBuy`/`executeSell` is bounded by
 * `RECEIPT_TIMEOUT_MS` (20s) so the webhook handler ACKs Telegram in
 * time. When the receipt isn't seen in that window the trade returns
 * `kind: "pending"` with the tx hash attached. This module owns what
 * happens next: persist the in-flight tx in the chat's Durable Object
 * storage, set a DO alarm, and re-poll `getTransactionReceipt` on every
 * fire until the chain settles the tx (success or revert) or a hard
 * deadline is reached. The user-visible bubble is edited in place with
 * the final outcome.
 *
 * The storage + alarm lives on `ChatDO` (one DO per Telegram chat), so
 * pending polls for the same user share an event loop and never race
 * each other. Idempotency commit-log entries are finalised here too so
 * a webhook-retry that arrives after the alarm settles still surfaces
 * the recorded outcome instead of resubmitting.
 */

import type {
  DurableObjectStorage,
} from "@cloudflare/workers-types";
import {
  TransactionReceiptNotFoundError,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import { markFinal, type IdempotencyKv } from "./idempotency.js";
import { logger } from "./logger.js";
import { isBenignEditError } from "./nav.js";
import {
  buildPublicClient,
  explorerTxUrl,
  extractBuyTokensOut,
  extractSellUsdcOut,
  renderExecutionError,
  toIntentResult,
  type ExecutionResult,
} from "./trade.js";
import type { Env } from "./types.js";

/** How often the alarm re-polls each in-flight tx. */
export const PENDING_TX_POLL_INTERVAL_MS = 5_000;

/**
 * Hard cap on how long we keep polling a single pending tx. After this
 * the bubble is finalised as `pending` (with explorer link) and the
 * record is dropped — the chain may still settle the tx later but
 * we've stopped tracking it. 30 minutes covers the long tail of
 * HyperEVM congestion without keeping zombie entries in DO storage
 * forever.
 */
export const PENDING_TX_MAX_POLL_DURATION_MS = 30 * 60 * 1000;

const PENDING_TX_PREFIX = "pendingTx:";

const storageKey = (txHash: Hash): string =>
  `${PENDING_TX_PREFIX}${txHash.toLowerCase()}`;

/**
 * Persisted state for one in-flight tx. Strings instead of bigints so
 * the record round-trips through JSON inside the DO's typed storage
 * layer (DO storage serialises via `structuredClone`, which DOES
 * support bigint, but the idempotency layer below stores the same
 * data as strings — keeping both shapes aligned avoids one extra
 * conversion step on each finalisation).
 */
export interface PendingTxRecord {
  txHash: Hash;
  chatId: number;
  messageId: number;
  side: "buy" | "sell";
  ticker: string;
  /** Token contract address (0x…). */
  token: string;
  /** Simulated quote at submission, raw decimal string. */
  quotedOut: string;
  /** Slippage floor at submission, raw decimal string. */
  minOut: string;
  /** ms epoch when the pending entry was first scheduled. */
  startedAt: number;
  /** Optional KV idempotency key to mark final once mined. */
  idempotencyKey?: string;
}

interface SchedulerEnv {
  storage: DurableObjectStorage;
}

/**
 * Persist a pending-tx record and (re)set the DO alarm so it fires no
 * later than `PENDING_TX_POLL_INTERVAL_MS` from now. Callers invoke
 * this immediately after `runWithTxStatusUpdates` sees a `pending`
 * outcome — the alarm takes over from there.
 */
export const schedulePendingTxPoll = async (
  env: SchedulerEnv,
  record: PendingTxRecord,
): Promise<void> => {
  await env.storage.put(storageKey(record.txHash), record);
  const existing = await env.storage.getAlarm();
  const next = Date.now() + PENDING_TX_POLL_INTERVAL_MS;
  if (existing === null || existing > next) {
    await env.storage.setAlarm(next);
  }
};

/**
 * Telegram-side bubble editor. We call the Bot API REST endpoint
 * directly (one `fetch` per edit) instead of instantiating a full
 * grammY `Bot` here: the alarm path has no `Context`, no session, no
 * middleware to drive — just a single `editMessageText` call. Keeps
 * the bundle small and tests trivial to mock.
 */
interface BubbleEditor {
  editMessageText: (
    rec: PendingTxRecord,
    text: string,
  ) => Promise<void>;
}

const buildEditor = (env: Pick<Env, "TELEGRAM_BOT_TOKEN">): BubbleEditor => {
  return {
    editMessageText: async (rec, text) => {
      const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: rec.chatId,
          message_id: rec.messageId,
          text,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let description = body;
        try {
          const parsed = JSON.parse(body) as { description?: string };
          if (parsed.description) description = parsed.description;
        } catch {
          // body wasn't JSON
        }
        const err = new Error(
          `editMessageText ${res.status}: ${description}`,
        ) as Error & {
          error_code: number;
          description: string;
        };
        err.error_code = res.status;
        err.description = description;
        throw err;
      }
    },
  };
};

const safeEdit = async (
  editor: BubbleEditor,
  rec: PendingTxRecord,
  text: string,
): Promise<void> => {
  try {
    await editor.editMessageText(rec, text);
  } catch (err) {
    if (isBenignEditError(err)) return;
    logger.debug("pendingTx edit failed", { err, txHash: rec.txHash });
  }
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const formatToken18 = (raw: bigint): string => {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / 10n ** 18n;
  const frac = abs % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  const body = fracStr.length === 0 ? whole.toString() : `${whole}.${fracStr}`;
  return negative ? `-${body}` : body;
};

const formatUsdc = (raw: bigint): string => {
  const whole = raw / 1_000_000n;
  const cents = raw % 1_000_000n;
  return `${whole}.${cents.toString().padStart(6, "0").slice(0, 2)}`;
};

/**
 * Render the post-receipt bubble for a finalised pending tx. Kept
 * compatible with `renderConfirmReply` (same HTML shape) so a user
 * sees the same final layout whether the receipt landed in-band or
 * via the alarm path.
 */
const renderFinal = (
  rec: PendingTxRecord,
  result: ExecutionResult,
): string => {
  if (result.ok) {
    const verb = rec.side === "buy" ? "Buy" : "Sell";
    const tickerSafe = escapeHtml(rec.ticker);
    const tokenSafe = escapeHtml(rec.token);
    let receivedLine = "";
    if (rec.side === "buy" && result.actualTokensOut !== undefined) {
      receivedLine = `Received: ${formatToken18(result.actualTokensOut)} ${tickerSafe}\n`;
    } else if (rec.side === "sell" && result.actualUsdcOut !== undefined) {
      receivedLine = `Received: $${formatUsdc(result.actualUsdcOut)} USDC\n`;
    }
    return (
      `✅ <b>${verb} confirmed for ${tickerSafe}</b>\n\n` +
      `${receivedLine}` +
      `<code>${tokenSafe}</code>\n` +
      `\n` +
      `Tx:\n` +
      `<a href="${explorerTxUrl(result.txHash)}">${result.txHash}</a>`
    );
  }
  const prefix = result.kind === "pending" ? "⏳" : "❌";
  return `${prefix} ${renderExecutionError(result)}`;
};

interface PollContext {
  publicClient: PublicClient;
  editor: BubbleEditor;
  kv: IdempotencyKv;
  storage: DurableObjectStorage;
  now: number;
}

const receiptToResult = (
  rec: PendingTxRecord,
  receipt: TransactionReceipt,
): ExecutionResult => {
  if (receipt.status !== "success") {
    return {
      ok: false,
      kind: "reverted",
      reason: "execution reverted",
      txHash: rec.txHash,
    };
  }
  const actualTokensOut =
    rec.side === "buy" ? extractBuyTokensOut(receipt.logs) : undefined;
  const actualUsdcOut =
    rec.side === "sell" ? extractSellUsdcOut(receipt.logs) : undefined;
  return {
    ok: true,
    txHash: rec.txHash,
    quotedOut: BigInt(rec.quotedOut),
    minOut: BigInt(rec.minOut),
    ...(actualTokensOut !== undefined ? { actualTokensOut } : {}),
    ...(actualUsdcOut !== undefined ? { actualUsdcOut } : {}),
  };
};

/**
 * Treat any "not found" / "not yet mined" RPC shape as still-pending.
 * viem throws `TransactionReceiptNotFoundError` for the canonical case
 * but providers can wrap or re-message; the substring check is the
 * conservative net.
 */
const isReceiptNotFound = (err: unknown): boolean => {
  if (err instanceof TransactionReceiptNotFoundError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /not.*found/i.test(msg) || /could not be found/i.test(msg);
};

const pollOne = async (
  rec: PendingTxRecord,
  poll: PollContext,
): Promise<{ finalised: boolean }> => {
  try {
    const receipt = await poll.publicClient.getTransactionReceipt({
      hash: rec.txHash,
    });
    const result = receiptToResult(rec, receipt);
    await safeEdit(poll.editor, rec, renderFinal(rec, result));
    if (rec.idempotencyKey) {
      try {
        await markFinal(poll.kv, rec.idempotencyKey, toIntentResult(result));
      } catch (err) {
        logger.debug("pendingTx idempotency markFinal failed", {
          err,
          key: rec.idempotencyKey,
        });
      }
    }
    await poll.storage.delete(storageKey(rec.txHash));
    return { finalised: true };
  } catch (err) {
    if (!isReceiptNotFound(err)) {
      logger.warn("pendingTx poll RPC error", { err, txHash: rec.txHash });
    }
    if (poll.now - rec.startedAt > PENDING_TX_MAX_POLL_DURATION_MS) {
      const giveUp: ExecutionResult = {
        ok: false,
        kind: "pending",
        txHash: rec.txHash,
        reason: "Receipt not seen within 30 minutes.",
      };
      await safeEdit(poll.editor, rec, renderFinal(rec, giveUp));
      await poll.storage.delete(storageKey(rec.txHash));
      return { finalised: true };
    }
    return { finalised: false };
  }
};

/**
 * Alarm handler. Loads every pending-tx record, polls each via
 * `getTransactionReceipt`, finalises the ones that have mined, and
 * reschedules the alarm if any remain.
 */
export const processPendingTxAlarm = async (
  env: Env,
  storage: DurableObjectStorage,
): Promise<void> => {
  const all = (await storage.list<PendingTxRecord>({
    prefix: PENDING_TX_PREFIX,
  })) as unknown as Map<string, PendingTxRecord>;
  if (all.size === 0) return;

  const publicClient = buildPublicClient(env);
  const editor = buildEditor(env);
  const ctx: PollContext = {
    publicClient,
    editor,
    kv: env.WALLET_KV as unknown as IdempotencyKv,
    storage,
    now: Date.now(),
  };

  let anyRemaining = false;
  for (const rec of all.values()) {
    const { finalised } = await pollOne(rec, ctx);
    if (!finalised) anyRemaining = true;
  }

  if (anyRemaining) {
    await storage.setAlarm(Date.now() + PENDING_TX_POLL_INTERVAL_MS);
  }
};
