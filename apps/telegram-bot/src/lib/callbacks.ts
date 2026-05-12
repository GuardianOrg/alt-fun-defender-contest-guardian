import { answerCallbackQuery } from "./telegram.js";
import type { TelegramCallbackQuery } from "./telegram.js";
import type { Env } from "./types.js";

/**
 * Telegram enforces a 64-byte ceiling on inline-button `callback_data`.
 * Exceeding it on the API side returns a 400 from setMessage, and any
 * forged update past the ceiling is dropped at parse time on our side.
 */
export const CALLBACK_DATA_LIMIT = 64;

const SEPARATOR = ":";

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export class CallbackEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallbackEncodeError";
  }
}

/**
 * Encode `cmd` + positional args into a colon-separated payload that
 * fits inside `CALLBACK_DATA_LIMIT`. Throws synchronously when the
 * payload is over budget or any arg contains the separator — silently
 * truncating would route the click to the wrong handler. Use short
 * codes per AGENTS.md (`s:50:<addr8>`, not the full address) to stay
 * inside the budget.
 */
export const encodeCallback = (cmd: string, ...args: string[]): string => {
  if (cmd === "" || cmd.includes(SEPARATOR)) {
    throw new CallbackEncodeError(
      `callback cmd must be non-empty and contain no '${SEPARATOR}'`,
    );
  }
  for (const arg of args) {
    if (arg.includes(SEPARATOR)) {
      throw new CallbackEncodeError(
        `callback args must not contain '${SEPARATOR}'`,
      );
    }
  }
  const data = [cmd, ...args].join(SEPARATOR);
  const bytes = utf8Bytes(data);
  if (bytes > CALLBACK_DATA_LIMIT) {
    throw new CallbackEncodeError(
      `callback_data is ${bytes} bytes; Telegram limit is ${CALLBACK_DATA_LIMIT}`,
    );
  }
  return data;
};

export interface ParsedCallback {
  cmd: string;
  args: string[];
}

/**
 * Parse a callback_data string emitted by `encodeCallback`. Returns
 * `null` when the payload is empty, over-budget, or otherwise malformed.
 * Callers should fall back to a generic "button expired" toast on null.
 */
export const parseCallback = (data: string): ParsedCallback | null => {
  if (data === "") return null;
  if (utf8Bytes(data) > CALLBACK_DATA_LIMIT) return null;
  const parts = data.split(SEPARATOR);
  const cmd = parts[0]!;
  if (cmd === "") return null;
  return { cmd, args: parts.slice(1) };
};

export interface CallbackAnswer {
  text?: string;
  show_alert?: boolean;
}

export interface CallbackContext {
  env: Env;
  query: TelegramCallbackQuery;
  args: string[];
}

/**
 * Handlers return an optional toast — when omitted the dispatcher
 * answers with an empty toast which just dismisses the button spinner.
 * Throwing surfaces a generic error toast and prevents the handler's
 * partial state from leaking into the user reply.
 */
export type CallbackHandler = (
  ctx: CallbackContext,
) => Promise<CallbackAnswer | void>;

export type CallbackRegistry = ReadonlyMap<string, CallbackHandler>;

/**
 * Production registry. Currently empty — interactive flows
 * (`/positions` pagination, sell-from-position buttons, withdraw
 * confirms) register their handlers here in follow-up PRs. The
 * dispatcher already wired into `routes/webhook.ts` so the only thing
 * future PRs add is the `Map.set(cmd, handler)` call.
 *
 * Replay protection (one-time nonce per confirm callback, AGENTS.md
 * "Security Model") is intentionally not built in here — it requires
 * KV-backed session state which isn't bound yet. Handlers that gate
 * destructive actions must layer it on themselves when the session
 * store lands.
 */
export const callbackHandlers: Map<string, CallbackHandler> = new Map();

/**
 * Always answers the callback_query exactly once, even when the
 * handler throws or the payload is unroutable. Skipping the answer
 * would leave the Telegram client spinning for ~30s and surface a
 * misleading "could not be answered" error to the user.
 */
export const dispatchCallback = async (
  env: Env,
  query: TelegramCallbackQuery,
  registry: CallbackRegistry,
): Promise<void> => {
  let answer: CallbackAnswer = {};

  const parsed = query.data !== undefined ? parseCallback(query.data) : null;
  if (!parsed) {
    answer = { text: "Button expired or invalid." };
  } else {
    const handler = registry.get(parsed.cmd);
    if (!handler) {
      answer = { text: "Unknown action." };
    } else {
      try {
        const result = await handler({ env, query, args: parsed.args });
        if (result) answer = result;
      } catch (err) {
        console.error("callback handler failed", err);
        answer = {
          text: "Something went wrong — please try again.",
          show_alert: true,
        };
      }
    }
  }

  try {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, query.id, answer);
  } catch (err) {
    // Best-effort — Telegram outages must not loop the webhook update,
    // and there is no retry surface for answerCallbackQuery anyway.
    console.error("answerCallbackQuery failed", err);
  }
};
