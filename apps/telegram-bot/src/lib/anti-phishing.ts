/**
 * Anti-phishing header prepended to every user-facing chat message
 * (sendMessage / editMessageText) per AGENTS.md "Security Model".
 *
 * When the user has set a personal phrase via /security it is used in
 * place of the static fallback — that's what makes the header proof
 * the message is from the real bot, since a copycat account can't see
 * the user's session and won't know their phrase. Users who have not
 * set a phrase fall back to the static reminder below.
 *
 * Toast / callback answer text (answerCallbackQuery, ~200 char limit)
 * is intentionally exempt — the header would consume most of the
 * budget and the toast itself isn't an impersonation surface.
 */
import {
  ANTI_PHISHING_STATIC_HEADER,
  DEFAULT_LANGUAGE,
  type Language,
  getCtxLanguage,
  t,
} from "./i18n.js";

/**
 * Backwards-compatible alias for the English static header. Callers
 * that have a context should prefer `staticAntiPhishingHeader(lang)` or
 * the ctx-aware wrappers below so the fallback is localised to the
 * user's `/settings → Language` preference.
 */
export const ANTI_PHISHING_HEADER = ANTI_PHISHING_STATIC_HEADER.English;

export const staticAntiPhishingHeader = (
  lang: Language = DEFAULT_LANGUAGE,
): string => t(ANTI_PHISHING_STATIC_HEADER, lang);

export const resolveAntiPhishingHeader = (
  phrase: string | null | undefined,
  lang: Language = DEFAULT_LANGUAGE,
): string => phrase ?? staticAntiPhishingHeader(lang);

export const withAntiPhishing = (
  body: string,
  phrase?: string | null,
  lang: Language = DEFAULT_LANGUAGE,
): string => `${resolveAntiPhishingHeader(phrase, lang)}\n\n${body}`;

/**
 * Pull the user's phrase from a grammY context safely. Two callsites
 * hit `ctx.session` without a real backing store: conversations replay
 * (no `session` property) and channel-post / anonymous-admin updates
 * where the session-key resolver returns undefined (grammY throws on
 * access). Both surface as the static fallback — the phrase is per-
 * user, so no user means no phrase.
 */
export const ctxAntiPhishingPhrase = (ctx: {
  session?: { antiPhishingPhrase?: string };
}): string | undefined => {
  try {
    return ctx.session?.antiPhishingPhrase;
  } catch {
    return undefined;
  }
};

export const wrapWithCtxPhrase = (
  ctx: { session?: { antiPhishingPhrase?: string; language?: Language } },
  body: string,
): string =>
  withAntiPhishing(body, ctxAntiPhishingPhrase(ctx), getCtxLanguage(ctx));
