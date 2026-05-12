export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  /**
   * Absent when the originating message has been deleted or is too old
   * (>48h). Handlers that want to edit must guard for this case — see
   * `editMessageText` below for the 400-as-no-op contract.
   */
  message?: TelegramMessage;
  /** 1–64 bytes of arbitrary data set on the inline button. */
  data?: string;
  /** Stable identifier of the chat-instance the button was clicked in. */
  chat_instance: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

const API_BASE = "https://api.telegram.org";

export const callTelegram = async (
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Response> => {
  return fetch(`${API_BASE}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
};

/**
 * Plain-text message by default. parse_mode is opt-in (`extra: { parse_mode:
 * "HTML" }` or `"MarkdownV2"`) so callers that interpolate user-controlled
 * strings (names, token symbols, addresses) don't accidentally let `<`, `>`,
 * `&`, or `*` turn a greeting into a Telegram parser error or a markup
 * injection. When you do enable parse_mode, escape the interpolated
 * substrings — Telegram's HTML mode rejects unbalanced tags and entity errors
 * surface as 400 responses.
 */
export const sendMessage = (
  botToken: string,
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
) =>
  callTelegram(botToken, "sendMessage", {
    ...extra,
    chat_id: chatId,
    text,
  });

/**
 * Telegram requires every callback_query to be answered within ~30s,
 * otherwise the client keeps the button spinner alive and surfaces an
 * error to the user. `text` is the optional toast — empty answers
 * dismiss the spinner silently. `show_alert: true` turns the toast into
 * a modal the user must dismiss; reserve it for hard errors.
 */
export const answerCallbackQuery = (
  botToken: string,
  callbackQueryId: string,
  opts: { text?: string; show_alert?: boolean } = {},
) => {
  const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (opts.text !== undefined) payload.text = opts.text;
  if (opts.show_alert !== undefined) payload.show_alert = opts.show_alert;
  return callTelegram(botToken, "answerCallbackQuery", payload);
};

/**
 * `chat_id` / `message_id` / `text` land after `...extra` so an upstream
 * caller cannot accidentally override the routing keys via the extras
 * bag — matches the contract enforced on `sendMessage`. Returns the raw
 * Response so callers can detect Telegram's "message not found" 400 and
 * treat it as a no-op per AGENTS.md.
 */
export const editMessageText = (
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {},
) =>
  callTelegram(botToken, "editMessageText", {
    ...extra,
    chat_id: chatId,
    message_id: messageId,
    text,
  });
