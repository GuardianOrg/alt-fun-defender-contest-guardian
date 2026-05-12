/**
 * Telegram enforces a 64-byte ceiling on inline-button `callback_data`.
 * Exceeding it on the API side returns a 400 from setMessage, and any
 * forged update past the ceiling is dropped at parse time on our side.
 *
 * grammY handles callback_query dispatch directly via `bot.callbackQuery`
 * matchers; the legacy dispatcher this module used to expose was
 * removed during the grammY migration. What remains is the
 * encode/parse pair plus the budget constant, which keep our
 * callback_data construction in `lib/format.ts` and
 * `keyboards/wallet-actions.ts` safe at the byte boundary that grammY
 * doesn't enforce on its own.
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
 * Useful for shared helpers (positions pagination, future flows) that
 * decode `callback_data` outside of grammY's regex matchers.
 */
export const parseCallback = (data: string): ParsedCallback | null => {
  if (data === "") return null;
  if (utf8Bytes(data) > CALLBACK_DATA_LIMIT) return null;
  const parts = data.split(SEPARATOR);
  const cmd = parts[0]!;
  if (cmd === "") return null;
  return { cmd, args: parts.slice(1) };
};
