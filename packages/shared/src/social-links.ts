/**
 * Sanitisers + safe URL builders for the three creator-supplied social fields
 * stored on every token (`twitterUrl`, `telegramUrl`, `websiteUrl`) and on
 * user profiles (`twitterUrl`).
 *
 * Why this exists: the on-chain `Bonding.TokenInfo.urls[]` array and the
 * profile-update endpoint both accept arbitrary strings. Those strings are
 * eventually rendered as the `href` of an `<a>` in the UI. Without
 * normalisation the API has been storing values like `javascript:alert(1)`,
 * `https://x.com.evil.tld/login`, or IDN homographs (`https://х.com/...`),
 * any of which becomes a stored phishing or XSS sink the moment a future
 * render path drops the current `startsWith("http")` guard. See
 * https://github.com/bounce-tech/alt-fun/issues/400.
 *
 * Strategy:
 *   - Twitter / X and Telegram are stored as **handles only** (e.g. `alice`
 *     or `joinchat/abc`). The frontend always builds the URL deterministically
 *     via {@link buildTwitterUrl} / {@link buildTelegramUrl}, so even a stray
 *     non-handle character can't escape into an `href`.
 *   - Websites are stored as a **canonical http(s) URL** that round-trips
 *     through `new URL()`. Non-http(s) schemes, userinfo, single-label hosts
 *     and non-ASCII hostnames are all rejected.
 *
 * Every helper is total: it never throws and never returns a value that
 * could become an unsafe href when concatenated into the canonical
 * URL templates above. Anything that fails validation collapses to the
 * empty string / `null` so the link simply doesn't render.
 */

/**
 * Twitter handle: 1-15 chars, `[A-Za-z0-9_]`. Twitter's own UI doesn't
 * allow longer handles, so anything past this is suspicious.
 */
const TWITTER_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Telegram public username: officially 5-32 chars, but we accept 4+ because
 * legacy / test usernames in the wild can be slightly shorter.
 */
const TELEGRAM_USERNAME_RE = /^[A-Za-z0-9_]{4,32}$/;

/**
 * Telegram invite-link tail (`+abc`, `joinchat/<hash>`). Hash characters are
 * URL-safe alphanumerics + `-`, `_`. Length cap is generous; Telegram's own
 * hashes sit around 16-24 chars but we don't pin to that.
 */
const TELEGRAM_INVITE_TAIL_RE = /^[A-Za-z0-9_-]{4,64}$/;

const TWITTER_HOSTS = new Set<string>([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

const TELEGRAM_HOSTS = new Set<string>([
  "t.me",
  "www.t.me",
  "telegram.me",
  "www.telegram.me",
]);

/**
 * Extract a Twitter / X handle from any creator-supplied form.
 *
 * Accepts (and normalises to a bare handle):
 *   - `@alice` -> `alice`
 *   - `alice` -> `alice`
 *   - `https://x.com/alice` -> `alice`
 *   - `https://twitter.com/alice/status/123...` -> `alice`
 *
 * Returns `""` for anything that can't be reduced to a valid handle —
 * including `javascript:`, foreign hosts (`https://x.com.evil.tld`),
 * IDN homographs, and over-long handles.
 */
export function sanitizeTwitterHandle(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (s === "") return "";

  if (looksLikeUrl(s)) {
    const url = parseUrl(s);
    if (!url) return "";
    if (!isHttpProtocol(url)) return "";
    if (!TWITTER_HOSTS.has(url.hostname.toLowerCase())) return "";
    const first = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
    return TWITTER_HANDLE_RE.test(first) ? first : "";
  }

  const handle = s.replace(/^@/, "");
  return TWITTER_HANDLE_RE.test(handle) ? handle : "";
}

/**
 * Extract a Telegram path component from any creator-supplied form.
 *
 * Three legal stored shapes:
 *   - `username` (public channel/user)
 *   - `+abcDEF123` (invite link, post-2020 format)
 *   - `joinchat/<hash>` (invite link, legacy format)
 *
 * Anything else collapses to `""`.
 */
export function sanitizeTelegramHandle(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (s === "") return "";

  if (looksLikeUrl(s)) {
    const url = parseUrl(s);
    if (!url) return "";
    if (!isHttpProtocol(url)) return "";
    if (!TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) return "";
    return validateTelegramPath(url.pathname.replace(/^\/+/, ""));
  }

  // Bare-string forms users commonly type in the UI. We special-case `t.me/`
  // because the TokenForm placeholder ("t.me/...") teaches users to enter
  // it that way; without this branch we'd reject every such input.
  const lowered = s.toLowerCase();
  if (lowered.startsWith("t.me/")) {
    return validateTelegramPath(s.slice("t.me/".length));
  }
  if (lowered.startsWith("telegram.me/")) {
    return validateTelegramPath(s.slice("telegram.me/".length));
  }

  // Bare invite codes (`+abc...` or `joinchat/...`) follow the same rules as
  // their `t.me/` URL counterparts.
  if (s.startsWith("+") || s.startsWith("joinchat/")) {
    return validateTelegramPath(s);
  }

  const handle = s.replace(/^@/, "");
  return TELEGRAM_USERNAME_RE.test(handle) ? handle : "";
}

function validateTelegramPath(path: string): string {
  if (path === "" || path.includes("..") || path.includes("\\")) return "";

  if (path.startsWith("+")) {
    const tail = path.slice(1);
    return TELEGRAM_INVITE_TAIL_RE.test(tail) ? `+${tail}` : "";
  }

  if (path.startsWith("joinchat/")) {
    const tail = path.slice("joinchat/".length);
    return TELEGRAM_INVITE_TAIL_RE.test(tail) ? `joinchat/${tail}` : "";
  }

  // Public username — first segment only, ignore deep links like
  // `/<channel>/<message-id>`.
  const first = path.split("/")[0] ?? "";
  return TELEGRAM_USERNAME_RE.test(first) ? first : "";
}

/**
 * Validate + canonicalise a creator-supplied website URL.
 *
 * Returns the round-tripped canonical form (`new URL(s).toString()`) for
 * an `http:` / `https:` URL with a multi-label ASCII hostname and no
 * embedded userinfo. Bare hosts (`example.com`) are auto-prefixed with
 * `https://`. Everything else returns `""`.
 *
 * Rejected examples (all return `""`):
 *   - `javascript:alert(1)`           — non-http scheme
 *   - `data:text/html,...`            — non-http scheme
 *   - `https://user:pwd@evil.com`     — embedded userinfo (phishing)
 *   - `https://localhost`             — single-label host
 *   - `https://х.com/foo` (Cyrillic)  — non-ASCII host (homograph)
 */
export function sanitizeWebsiteUrl(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (s === "") return "";

  // Force punycode entry for any internationalised domains. We check the
  // **raw** input rather than the post-parse hostname because WHATWG `URL`
  // silently converts `https://х.com` into `https://xn--u1a.com/` — by then
  // the IDN-homograph signal is gone. Users who genuinely need an IDN
  // website can paste the `xn--…` form directly. Punycode-encoded hosts
  // also won't render as their Unicode equivalents in modern browsers'
  // address bars when the script-mixing protections kick in.
  // eslint-disable-next-line no-control-regex
  if (/[^\u0000-\u007F]/.test(s)) return "";

  // A leading scheme means the user is asserting protocol — keep it as-is so
  // we can reject `javascript:` / `data:` etc. below. Otherwise prepend
  // `https://` so a plain `example.com` works the way users expect.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;

  const url = parseUrl(candidate);
  if (!url) return "";
  if (!isHttpProtocol(url)) return "";
  if (url.hostname === "" || !url.hostname.includes(".")) return "";
  if (url.username !== "" || url.password !== "") return "";
  if (!/^[A-Za-z0-9.-]+$/.test(url.hostname)) return "";

  return url.toString();
}

/**
 * Build a render-safe `https://x.com/<handle>` link from any stored value
 * (a bare handle from new-format rows, or a legacy URL from old rows).
 * Returns `null` when the value can't be reduced to a valid handle, so
 * callers can `if (!url) return null` instead of rendering a broken link.
 */
export function buildTwitterUrl(stored: string | null | undefined): string | null {
  const handle = sanitizeTwitterHandle(stored);
  return handle ? `https://x.com/${handle}` : null;
}

export function buildTelegramUrl(stored: string | null | undefined): string | null {
  const path = sanitizeTelegramHandle(stored);
  return path ? `https://t.me/${path}` : null;
}

export function buildWebsiteUrl(stored: string | null | undefined): string | null {
  const url = sanitizeWebsiteUrl(stored);
  return url || null;
}

function looksLikeUrl(s: string): boolean {
  // Anything with a scheme prefix (`https:`, `javascript:`, etc.) or a
  // protocol-relative `//` is treated as a URL so the parser can validate
  // it. Bare strings like `alice` fall through to the handle-extraction
  // path.
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) || s.startsWith("//");
}

function parseUrl(s: string): URL | null {
  try {
    return new URL(s.startsWith("//") ? `https:${s}` : s);
  } catch {
    return null;
  }
}

function isHttpProtocol(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}
