/**
 * Anti-phishing header prepended to every user-facing chat message
 * (sendMessage / editMessageText) per AGENTS.md "Security Model" and
 * the /help spec.
 *
 * v1 is the static phrase below. /settings will let users set a
 * personal phrase (shown back to them as proof the message is from
 * the real bot, not a Telegram-account phisher); when that lands,
 * `withAntiPhishing` should pull the user's phrase from session and
 * fall back to this static text for users who haven't set one.
 *
 * Toast / callback answer text (answerCallbackQuery, ~200 char limit)
 * is intentionally exempt — the header would consume most of the
 * budget and the toast itself isn't an impersonation surface.
 */
export const ANTI_PHISHING_HEADER =
  "This bot will never ask for your seed phrase or private key via DM.";

export const withAntiPhishing = (body: string): string =>
  `${ANTI_PHISHING_HEADER}\n\n${body}`;
