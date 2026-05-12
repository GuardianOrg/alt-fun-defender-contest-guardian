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

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
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
    chat_id: chatId,
    text,
    ...extra,
  });
