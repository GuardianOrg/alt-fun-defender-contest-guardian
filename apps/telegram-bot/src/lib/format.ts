import type {
  BotOpenPosition,
  BotPositionsResponse,
  BotRealisedPosition,
} from "./api.js";
import { encodeCallback } from "./callbacks.js";
import {
  DEFAULT_LANGUAGE,
  type Language,
  POSITIONS_BUY_TICKER_BUTTON,
  POSITIONS_NO_OPEN_POSITIONS_REPLY,
  POSITIONS_REALISED_POS_HEADER,
  POSITIONS_SELL_TICKER_BUTTON,
  REFRESH_BUTTON_TEXT,
  t,
} from "./i18n.js";
import { backHomeRow } from "./nav.js";

const TOKEN_DECIMALS = 18;
const USDC_DECIMALS = 6;
/**
 * Telegram silently 400s anything above 4096 characters. Use a slim margin
 * so trailing pagination hints fit without re-checking.
 */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Render a fixed-point integer string at `decimals` precision down to
 * `displayDecimals` places. Strips trailing zeros, trims an orphan decimal
 * point, and groups the integer portion with commas. Pure bigint arithmetic
 * — never goes through Number, so even billion-token positions render
 * losslessly.
 */
export const formatFixed = (
  raw: string,
  decimals: number,
  displayDecimals: number,
): string => {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fraction = abs % divisor;

  const fractionStr = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, displayDecimals);
  const trimmed = fractionStr.replace(/0+$/, "");

  const wholeWithSep = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = trimmed ? `${wholeWithSep}.${trimmed}` : wholeWithSep;
  return negative ? `-${body}` : body;
};

export const formatTokenAmount = (raw: string): string =>
  formatFixed(raw, TOKEN_DECIMALS, 4);

export const formatUsdc = (raw: string): string =>
  formatFixed(raw, USDC_DECIMALS, 2);

const LINE_PREFIX = "• ";

/**
 * Chunk position lines into one or more messages that each fit inside
 * Telegram's 4096-char ceiling. Header lands on the first chunk only — the
 * separator between positions counts toward the limit, so chunking happens
 * on cumulative size including the joiner.
 *
 * Kept as a general utility — still consumed by tests; positions itself
 * now paginates by record count per section (see `buildPositionsView`).
 */
export const chunkPositionsMessage = (
  header: string,
  lines: string[],
  limit: number = TELEGRAM_MESSAGE_LIMIT,
): string[] => {
  if (lines.length === 0) return [header];
  const chunks: string[] = [];
  let current = header;
  for (const line of lines) {
    const joiner = current === "" ? "" : "\n\n";
    if (current.length + joiner.length + line.length > limit) {
      if (current !== "") chunks.push(current);
      current = line;
      continue;
    }
    current = current === "" ? line : `${current}${joiner}${line}`;
  }
  if (current !== "") chunks.push(current);
  return chunks;
};

/**
 * Render a signed USDC raw value with a leading `+` for positives and
 * a Unicode minus (`−`) for negatives. The signed-number rule in
 * AGENTS.md applies to unrealised / realised PnL, where the leading
 * sign is the headline of the line.
 */
const formatSignedUsdc = (raw: string): string => {
  if (raw === "0") return "$0";
  if (raw.startsWith("-")) return `−$${formatUsdc(raw.slice(1))}`;
  return `+$${formatUsdc(raw)}`;
};

/**
 * Floor a percentage to two decimal places. `Math.floor` (not
 * `Math.trunc`) — for a negative loss like `-12.349%` the spec's
 * floor rounds toward −∞ to `-12.35%`, not toward zero. Use Unicode
 * minus for negatives to match the signed-number rule in AGENTS.md.
 */
const formatPct = (pct: number | null): string => {
  if (pct === null) return "—";
  const floored = Math.floor(pct * 100) / 100;
  if (floored < 0) return `−${(-floored).toFixed(2)}%`;
  if (floored > 0) return `+${floored.toFixed(2)}%`;
  return "0.00%";
};

/**
 * Escape a string for safe interpolation inside a Telegram HTML
 * message body. Tickers come from on-chain `Token.symbol()` and can
 * contain any UTF-8 — including `<`, `>`, `&` — so anything that lands
 * outside an HTML attribute must go through this. Attribute values
 * (the addresses in `<a href="...">`) are ASCII hex so they don't need
 * escaping, but we wrap them anyway to keep the call shape uniform.
 */
export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatTokenAddress = (token: string): string =>
  `<code>${token}</code>`;

/**
 * Render a `track_<addr>` deeplink to the bot. Tapping the ticker on a
 * position line bounces the user back into this same bot's chat with
 * `/start track_<addr>`, which the start handler routes to the /track
 * card. When `BOT_USERNAME` is missing the caller falls back to plain
 * text — no fabricated link is better than one that resolves to a
 * wrong / non-existent bot.
 */
const trackDeeplinkHref = (botUsername: string, token: string): string =>
  `https://t.me/${botUsername}?start=track_${token}`;

/**
 * Per-section page size. AGENTS.md "/positions" pagination is keyed on
 * record count (not message bytes) — exactly 5 entries per section per
 * page so the open and realised sections paginate independently.
 */
export const POSITIONS_PAGE_SIZE = 5;

/**
 * Per-page open-position metadata used by the keyboard builder to emit
 * one `[Buy <TICKER>] [Sell <TICKER>]` row per open position currently
 * visible. Scoped to the open page so navigating swaps the action rows
 * along with the body text.
 */
export interface PositionActionTarget {
  token: string;
  ticker: string;
}

/**
 * Per-line ticker cap measured in *post-escape* characters. On-chain
 * `Token.symbol()` is unbounded UTF-8 and may contain `<` / `>` / `&`
 * which expand 4x under `escapeHtml`, so the budget is enforced after
 * escaping. With 5 records per section per page (10 lines worst-case),
 * 64 escaped chars per ticker plus ~225 fixed-format chars per line
 * keeps the full view well below Telegram's 4096-char ceiling even if
 * every ticker is pathologically long.
 */
const TICKER_ESCAPED_MAX = 64;

/**
 * Strip Unicode control characters (`\r`, `\n`, `\t`, other Cc) from a
 * raw on-chain ticker. Token contracts return arbitrary UTF-8 and a
 * symbol carrying embedded newlines or tabs would split the HTML body
 * across lines or leak into inline-button labels — both produce broken
 * layout or, with a malicious ticker, partially controlled markup.
 * Collapse every control char run into a single space so downstream
 * escape + truncate sees a flat single-line string.
 */
const sanitizeTickerControlChars = (ticker: string): string =>
  // eslint-disable-next-line no-control-regex
  ticker.replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ");

/**
 * HTML-escape the ticker and clamp the result to `TICKER_ESCAPED_MAX`.
 * Strips control chars first so embedded `\n` / `\r` / `\t` from an
 * attacker-controlled `Token.symbol()` cannot leak into the body or
 * inline-button labels. If the cut would fall inside an HTML entity
 * (e.g. mid-`&amp;`) we backtrack to the previous `;` so the body
 * never emits a half-entity like `&am`.
 */
const truncateAndEscapeTicker = (ticker: string): string => {
  const escaped = escapeHtml(sanitizeTickerControlChars(ticker));
  if (escaped.length <= TICKER_ESCAPED_MAX) return escaped;
  let cut = escaped.slice(0, TICKER_ESCAPED_MAX - 1);
  const lastAmp = cut.lastIndexOf("&");
  const lastSemi = cut.lastIndexOf(";");
  if (lastAmp > lastSemi) cut = cut.slice(0, lastAmp);
  return `${cut}…`;
};

const formatOpenLine = (
  pos: BotOpenPosition,
  botUsername: string | null,
): string => {
  const labelRaw = truncateAndEscapeTicker(pos.ticker);
  const href = botUsername ? trackDeeplinkHref(botUsername, pos.token) : null;
  const label = href ? `<a href="${href}">${labelRaw}</a>` : labelRaw;
  return (
    `${LINE_PREFIX}${label}` +
    `\n  ${formatTokenAddress(pos.token)}` +
    `\n  ${formatTokenAmount(pos.balance)} · cost $${formatUsdc(pos.costBasisUsdc)}` +
    `\n  value $${formatUsdc(pos.currentValueUsdc)} · PnL ${formatSignedUsdc(pos.unrealisedPnlUsdc)} (${formatPct(pos.unrealisedPnlPct)})`
  );
};

const formatRealisedLine = (
  pos: BotRealisedPosition,
  botUsername: string | null,
): string => {
  const labelRaw = truncateAndEscapeTicker(pos.ticker);
  const href = botUsername ? trackDeeplinkHref(botUsername, pos.token) : null;
  const label = href ? `<a href="${href}">${labelRaw}</a>` : labelRaw;
  return (
    `${LINE_PREFIX}${label}` +
    `\n  ${formatTokenAddress(pos.token)}` +
    `\n  cost $${formatUsdc(pos.totalCostUsdc)} · proceeds $${formatUsdc(pos.totalProceedsUsdc)}` +
    `\n  realised ${formatSignedUsdc(pos.realisedPnlUsdc)} (${formatPct(pos.realisedPnlPct)})`
  );
};

const totalPagesOf = (total: number): number =>
  Math.max(1, Math.ceil(total / POSITIONS_PAGE_SIZE));

const clampPage = (page: number, totalPages: number): number => {
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.min(Math.floor(page), totalPages - 1);
};

/**
 * Single rendered view of one (openPage, realisedPage) tuple. The bot
 * sends one message per view; the keyboard builder consumes the same
 * struct to emit per-section nav rows and per-position action rows that
 * stay in sync with the visible body.
 */
export interface PositionsView {
  text: string;
  openTotal: number;
  realisedTotal: number;
  openTotalPages: number;
  realisedTotalPages: number;
  /** 0-indexed, clamped against `openTotalPages`. */
  openPage: number;
  /** 0-indexed, clamped against `realisedTotalPages`. */
  realisedPage: number;
  /** Open positions visible on this page (in render order). */
  openActions: PositionActionTarget[];
}

/**
 * Build the body text + per-section pagination metadata for one
 * (openPage, realisedPage) tuple. Each section paginates by record
 * count — `POSITIONS_PAGE_SIZE = 5` — independently. Page indices
 * outside the valid range are clamped, so a stale callback button
 * lands on the nearest live page rather than rendering blank.
 */
export const buildPositionsView = (
  data: BotPositionsResponse,
  openPage: number,
  realisedPage: number,
  botUsername: string | null = null,
  lang: Language = DEFAULT_LANGUAGE,
): PositionsView => {
  const openTotal = data.open.length;
  const realisedTotal = data.realised.length;
  const openTotalPages = totalPagesOf(openTotal);
  const realisedTotalPages = totalPagesOf(realisedTotal);
  const op = clampPage(openPage, openTotalPages);
  const rp = clampPage(realisedPage, realisedTotalPages);

  if (openTotal === 0 && realisedTotal === 0) {
    return {
      text: t(POSITIONS_NO_OPEN_POSITIONS_REPLY, lang),
      openTotal: 0,
      realisedTotal: 0,
      openTotalPages: 1,
      realisedTotalPages: 1,
      openPage: 0,
      realisedPage: 0,
      openActions: [],
    };
  }

  const openSlice = data.open.slice(
    op * POSITIONS_PAGE_SIZE,
    op * POSITIONS_PAGE_SIZE + POSITIONS_PAGE_SIZE,
  );
  const realisedSlice = data.realised.slice(
    rp * POSITIONS_PAGE_SIZE,
    rp * POSITIONS_PAGE_SIZE + POSITIONS_PAGE_SIZE,
  );

  const sections: string[] = [];
  if (openTotal > 0) {
    const header = `Open positions (${openTotal})`;
    const lines = openSlice.map((p) => formatOpenLine(p, botUsername));
    sections.push([header, ...lines].join("\n\n"));
  }
  if (realisedTotal > 0) {
    const header = `Realised positions (${realisedTotal})`;
    const lines = realisedSlice.map((p) => formatRealisedLine(p, botUsername));
    sections.push([header, ...lines].join("\n\n"));
  }

  // Final 4096-char guard. Per-ticker clamping plus the 5-per-section
  // page size keeps the realistic body well under Telegram's limit, but
  // the numeric fields are bigint-backed and an attacker-controlled
  // token contract can return pathologically large `balanceOf` values
  // (cost basis / current value are also unbounded in theory). If we
  // somehow blow the limit, fall back to a compact rendering that
  // keeps the ticker + token address per line and drops the numeric
  // detail — better a truncated view than a 400 from Telegram.
  let text = sections.join("\n\n");
  if (text.length > TELEGRAM_MESSAGE_LIMIT) {
    const compactOpenLines = openSlice.map(
      (p) =>
        `${LINE_PREFIX}${truncateAndEscapeTicker(p.ticker)}\n  ${formatTokenAddress(p.token)}`,
    );
    const compactRealisedLines = realisedSlice.map(
      (p) =>
        `${LINE_PREFIX}${truncateAndEscapeTicker(p.ticker)}\n  ${formatTokenAddress(p.token)}`,
    );
    const compact: string[] = [];
    if (openTotal > 0)
      compact.push(
        [`Open positions (${openTotal})`, ...compactOpenLines].join("\n\n"),
      );
    if (realisedTotal > 0)
      compact.push(
        [`Realised positions (${realisedTotal})`, ...compactRealisedLines].join(
          "\n\n",
        ),
      );
    text = compact.join("\n\n");
    if (text.length > TELEGRAM_MESSAGE_LIMIT) {
      // Last-resort hard slice; the compact form already drops the
      // numeric fields so reaching here would require >300 chars of
      // ticker per line across all 10 slots, which the ticker clamp
      // rules out.
      text = `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 1)}…`;
    }
  }

  return {
    text,
    openTotal,
    realisedTotal,
    openTotalPages,
    realisedTotalPages,
    openPage: op,
    realisedPage: rp,
    openActions: openSlice.map((p) => ({ token: p.token, ticker: p.ticker })),
  };
};

/**
 * Pagination callback. Carries both axes so a single click can move
 * one section without disturbing the other's page state:
 * `pp:<openPage>:<realisedPage>:<wallet>`.
 */
export const POSITIONS_PAGE_CALLBACK_CMD = "pp";

/**
 * Per-position buy/sell callback short codes (Telegram's 64-byte
 * `callback_data` ceiling is tight — `pb` / `ps` + 0x-prefixed 40-char
 * address fits with room to spare).
 */
export const POSITIONS_BUY_CALLBACK_CMD = "pb";
export const POSITIONS_SELL_CALLBACK_CMD = "ps";

/**
 * Refresh button. Re-fetches the wallet's positions and re-renders at
 * the same (openPage, realisedPage). Both indices ride in the callback
 * so a stale Refresh on a closed-out token clamps cleanly rather than
 * jumping back to page 1: `pr:<openPage>:<realisedPage>:<wallet>`.
 */
export const POSITIONS_REFRESH_CALLBACK_CMD = "pr";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

const truncateTickerForButton = (ticker: string): string => {
  const MAX = 12;
  // Sanitize control chars first — embedded `\n` / `\t` in an inline
  // button label produces broken layout on every Telegram client.
  const flat = sanitizeTickerControlChars(ticker);
  return flat.length > MAX ? `${flat.slice(0, MAX - 1)}…` : flat;
};

/**
 * Build the section-pagination nav row for a single section. Returns
 * an empty array when the section has at most one page — no buttons,
 * no row. Direction arrows point at the *target* page so a user on
 * page 1 sees `→ Page 2/10 Open Pos`, page 2 sees both `← Page 1/10`
 * and `→ Page 3/10`, and the last page shows only the `← Prev` button.
 *
 * `otherPage` is the other section's current page index — it rides in
 * every callback so each axis paginates independently.
 */
const sectionNavRow = (
  page: number,
  totalPages: number,
  wallet: string,
  label: string,
  buildCallback: (openPage: number, realisedPage: number) => string,
  axis: "open" | "realised",
  otherPage: number,
): InlineKeyboardButton[] => {
  if (totalPages <= 1) return [];
  const row: InlineKeyboardButton[] = [];
  const labelFor = (target: number, arrow: "←" | "→"): string =>
    `${arrow} Page ${target + 1}/${totalPages} ${label}`;
  if (page > 0) {
    const target = page - 1;
    row.push({
      text: labelFor(target, "←"),
      callback_data:
        axis === "open"
          ? buildCallback(target, otherPage)
          : buildCallback(otherPage, target),
    });
  }
  if (page < totalPages - 1) {
    const target = page + 1;
    row.push({
      text: labelFor(target, "→"),
      callback_data:
        axis === "open"
          ? buildCallback(target, otherPage)
          : buildCallback(otherPage, target),
    });
  }
  void wallet;
  return row;
};

/**
 * Build the inline-keyboard markup for one positions view: a
 * `[Buy <TICKER>] [Sell <TICKER>]` row per open position currently
 * visible, followed by per-section pagination rows (only when that
 * section has more than `POSITIONS_PAGE_SIZE` records), then a
 * `[🔄 Refresh]` row, then a trailing `[← Back] [🏠 Home]` row.
 *
 * Per-position Buy/Sell buttons fire inline via `pb:` / `ps:` callbacks
 * so the action card lands as the next message in the same chat. The
 * "view chart / track this token" affordance is the deeplinked ticker
 * inside the body text itself.
 *
 * Both page indices ride in nav `callback_data` so the bot survives
 * Worker cold-starts without a KV-backed page cache.
 */
export const buildPositionsPageKeyboard = (
  view: PositionsView,
  wallet: string,
  lang: Language = DEFAULT_LANGUAGE,
): InlineKeyboardMarkup => {
  const rows: InlineKeyboardButton[][] = [];
  for (const action of view.openActions) {
    const label = truncateTickerForButton(action.ticker);
    rows.push([
      {
        text: t(POSITIONS_BUY_TICKER_BUTTON, lang)(label),
        callback_data: encodeCallback(
          POSITIONS_BUY_CALLBACK_CMD,
          action.token,
        ),
      },
      {
        text: t(POSITIONS_SELL_TICKER_BUTTON, lang)(label),
        callback_data: encodeCallback(
          POSITIONS_SELL_CALLBACK_CMD,
          action.token,
        ),
      },
    ]);
  }

  const pageCallback = (openPage: number, realisedPage: number): string =>
    encodeCallback(
      POSITIONS_PAGE_CALLBACK_CMD,
      String(openPage),
      String(realisedPage),
      wallet,
    );

  const openNav = sectionNavRow(
    view.openPage,
    view.openTotalPages,
    wallet,
    "Open Pos",
    pageCallback,
    "open",
    view.realisedPage,
  );
  if (openNav.length > 0) rows.push(openNav);

  const realisedNav = sectionNavRow(
    view.realisedPage,
    view.realisedTotalPages,
    wallet,
    t(POSITIONS_REALISED_POS_HEADER, lang),
    pageCallback,
    "realised",
    view.openPage,
  );
  if (realisedNav.length > 0) rows.push(realisedNav);

  rows.push([
    {
      text: t(REFRESH_BUTTON_TEXT, lang),
      callback_data: encodeCallback(
        POSITIONS_REFRESH_CALLBACK_CMD,
        String(view.openPage),
        String(view.realisedPage),
        wallet,
      ),
    },
  ]);
  rows.push(backHomeRow());
  return { inline_keyboard: rows };
};
