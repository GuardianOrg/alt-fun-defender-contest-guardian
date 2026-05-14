import type {
  BotOpenPosition,
  BotPositionsResponse,
  BotRealisedPosition,
} from "./api.js";
import { encodeCallback } from "./callbacks.js";
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
 * Reserved tail budget for the pagination footer appended by
 * `renderPaginatedPage`. Worst-case footer is `\n\nPage 9999 of 9999`
 * (20 chars); 24 leaves headroom for any future format change without
 * reissuing chunk sizes. `chunkPositionsMessage` (and the approximate
 * truncation note path below) both honor this reservation so any
 * single page returned from `renderPaginatedPage` is guaranteed to
 * fit inside `TELEGRAM_MESSAGE_LIMIT` even with the footer attached.
 */
export const PAGINATION_FOOTER_BUDGET = 24;

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

/**
 * Wrap a 0x-prefixed token address in `<code>` so Telegram renders it
 * as a tap-to-copy monospace span on every platform (mobile long-press,
 * desktop click). The address is ASCII hex so no HTML escaping is
 * needed — kept as a raw string passthrough rather than running
 * `escapeHtml` unnecessarily.
 */
const formatTokenAddress = (token: string): string =>
  `<code>${token}</code>`;

const formatOpenLine = (pos: BotOpenPosition, limit: number): string => {
  const labelRaw = escapeHtml(pos.ticker);
  const suffix =
    `\n  ${formatTokenAddress(pos.token)}` +
    `\n  ${formatTokenAmount(pos.balance)} · cost $${formatUsdc(pos.costBasisUsdc)}` +
    `\n  value $${formatUsdc(pos.currentValueUsdc)} · PnL ${formatSignedUsdc(pos.unrealisedPnlUsdc)} (${formatPct(pos.unrealisedPnlPct)})`;
  const budget = limit - LINE_PREFIX.length - suffix.length;
  const label =
    labelRaw.length > budget
      ? `${labelRaw.slice(0, Math.max(1, budget - 1))}…`
      : labelRaw;
  return `${LINE_PREFIX}${label}${suffix}`;
};

const formatRealisedLine = (
  pos: BotRealisedPosition,
  limit: number,
): string => {
  const labelRaw = escapeHtml(pos.ticker);
  const suffix =
    `\n  ${formatTokenAddress(pos.token)}` +
    `\n  cost $${formatUsdc(pos.totalCostUsdc)} · proceeds $${formatUsdc(pos.totalProceedsUsdc)}` +
    `\n  realised ${formatSignedUsdc(pos.realisedPnlUsdc)} (${formatPct(pos.realisedPnlPct)})`;
  const budget = limit - LINE_PREFIX.length - suffix.length;
  const label =
    labelRaw.length > budget
      ? `${labelRaw.slice(0, Math.max(1, budget - 1))}…`
      : labelRaw;
  return `${LINE_PREFIX}${label}${suffix}`;
};

/**
 * Per-page open-position metadata. The pagination handler uses this to
 * emit one `[Buy <TICKER>] [Sell <TICKER>]` keyboard row per position
 * on the current page, scoped so navigating to a different page swaps
 * the action rows along with the body text.
 */
export interface PositionActionTarget {
  token: string;
  ticker: string;
}

export interface PositionsPage {
  text: string;
  /** Open positions whose lines land on this page (in render order). */
  openActions: PositionActionTarget[];
}

/**
 * Render the bot-positions response as a list of paginated pages. Open
 * and Realised sections share one paginated stream: Open header +
 * lines first, then Realised header + lines if any closed-out chunks
 * exist. The 4096-char-per-chunk limit and the pagination-footer
 * reservation match `formatPositionsResponse`.
 *
 * Each open-position line emits matching `PositionActionTarget` entries
 * on the page it lands on, so the pagination keyboard can attach a
 * `[Buy] [Sell]` row per position without the keyboard drifting out of
 * sync with the visible text when the user navigates between pages.
 */
export const formatBotPositionsResponse = (
  data: BotPositionsResponse,
): PositionsPage[] => {
  if (data.open.length === 0 && data.realised.length === 0) {
    return [{ text: "No open positions for this wallet.", openActions: [] }];
  }
  const limit = TELEGRAM_MESSAGE_LIMIT - PAGINATION_FOOTER_BUDGET;
  const lines: string[] = [];
  // Parallel to `lines` — `null` for non-open lines (headers, realised)
  // so the chunker can carry per-line action targets through alongside
  // the text without leaking any layout knowledge into the caller.
  const lineActions: (PositionActionTarget | null)[] = [];
  let header = "";
  if (data.open.length > 0) {
    header = `Open positions (${data.open.length})`;
    for (const p of data.open) {
      lines.push(formatOpenLine(p, limit));
      lineActions.push({ token: p.token, ticker: p.ticker });
    }
  }
  if (data.realised.length > 0) {
    const realisedHeader = `Realised positions (${data.realised.length})`;
    if (header === "") header = realisedHeader;
    else {
      lines.push(realisedHeader);
      lineActions.push(null);
    }
    for (const p of data.realised) {
      lines.push(formatRealisedLine(p, limit));
      lineActions.push(null);
    }
  }
  return chunkPositionsPages(header, lines, lineActions, limit);
};

/**
 * Chunk position lines into pages that each fit inside Telegram's
 * 4096-char ceiling, threading per-line `PositionActionTarget` metadata
 * through unchanged. Mirrors `chunkPositionsMessage`'s greedy packing
 * (header on first chunk only, joiner counted toward the limit) — kept
 * as a parallel implementation rather than a shared helper because the
 * action-target plumbing would otherwise leak into the text-only chunk
 * helper (still consumed by tests).
 */
const chunkPositionsPages = (
  header: string,
  lines: string[],
  lineActions: (PositionActionTarget | null)[],
  limit: number = TELEGRAM_MESSAGE_LIMIT,
): PositionsPage[] => {
  if (lines.length === 0) return [{ text: header, openActions: [] }];
  const pages: PositionsPage[] = [];
  let currentText = header;
  let currentActions: PositionActionTarget[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const action = lineActions[i] ?? null;
    const joiner = currentText === "" ? "" : "\n\n";
    if (currentText.length + joiner.length + line.length > limit) {
      if (currentText !== "")
        pages.push({ text: currentText, openActions: currentActions });
      currentText = line;
      currentActions = action ? [action] : [];
      continue;
    }
    currentText = currentText === "" ? line : `${currentText}${joiner}${line}`;
    if (action) currentActions.push(action);
  }
  if (currentText !== "")
    pages.push({ text: currentText, openActions: currentActions });
  return pages;
};

export const POSITIONS_PAGE_CALLBACK_CMD = "pp";
/**
 * Per-position buy/sell/track callback short codes (Telegram's 64-byte
 * `callback_data` ceiling is tight — `pb`/`ps`/`pt` + 0x-prefixed
 * 40-char address fits with room to spare).
 */
export const POSITIONS_BUY_CALLBACK_CMD = "pb";
export const POSITIONS_SELL_CALLBACK_CMD = "ps";
export const POSITIONS_TRACK_CALLBACK_CMD = "pt";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Render one page of a paginated positions response. A multi-page reply
 * gets a `Page X/Y` footer so the user knows where they are; a single
 * page renders verbatim. The keyboard handles navigation — see
 * `buildPositionsPageKeyboard` for the matching nav row.
 */
export const renderPaginatedPage = (
  pages: PositionsPage[],
  page: number,
): string => {
  if (pages.length === 0) return "";
  const safePage = Math.max(0, Math.min(page, pages.length - 1));
  const body = pages[safePage]!.text;
  if (pages.length === 1) return body;
  return `${body}\n\nPage ${safePage + 1} of ${pages.length}`;
};

/**
 * Truncate a ticker so the rendered `[Buy <TICKER>]` / `[Sell <TICKER>]`
 * button label stays readable on narrow clients. Buttons word-wrap on
 * Telegram desktop but the truncated form is preferable to multi-line
 * keyboard rows. 12 chars is the typical iOS portrait budget.
 */
const truncateTickerForButton = (ticker: string): string => {
  const MAX = 12;
  return ticker.length > MAX ? `${ticker.slice(0, MAX - 1)}…` : ticker;
};

/**
 * Build the inline-keyboard markup for one page: a `[Buy <TICKER>]
 * [Sell <TICKER>]` row per open position on the page, optionally
 * followed by a `[← Prev] [Next →]` nav row when the response
 * paginates, then a trailing `[Close]` row. Always returns a
 * keyboard — even an empty-state page surfaces Close so the user can
 * dismiss the prompt.
 *
 * Per-position buttons replace the legacy `Buy` / `Sell` HTML anchors
 * that pointed at `t.me/<bot>?start=buy_<addr>` deeplinks. The anchors
 * bounced the user through Telegram's link-handler UI even inside the
 * same bot's chat; callback buttons fire inline so the action card
 * lands as the next message in the same chat.
 *
 * The wallet rides in nav `callback_data` (not server-side state) so
 * the bot survives Worker cold-starts without a KV-backed page cache.
 * Per-position buttons don't need the wallet — the buy/sell card is
 * scoped to the user's active wallet, resolved at click time.
 */
export const buildPositionsPageKeyboard = (
  page: number,
  totalPages: number,
  wallet: string,
  openActions: PositionActionTarget[],
): InlineKeyboardMarkup => {
  const rows: InlineKeyboardButton[][] = [];
  for (const action of openActions) {
    const label = truncateTickerForButton(action.ticker);
    // Per-position track row — labelled with the ticker so it reads as
    // a "name link" for the position. Tapping edits the /positions
    // message in place into the /track view for this token.
    rows.push([
      {
        text: label,
        callback_data: encodeCallback(
          POSITIONS_TRACK_CALLBACK_CMD,
          action.token,
        ),
      },
    ]);
    rows.push([
      {
        text: `Buy ${label}`,
        callback_data: encodeCallback(
          POSITIONS_BUY_CALLBACK_CMD,
          action.token,
        ),
      },
      {
        text: `Sell ${label}`,
        callback_data: encodeCallback(
          POSITIONS_SELL_CALLBACK_CMD,
          action.token,
        ),
      },
    ]);
  }
  const nav: InlineKeyboardButton[] = [];
  if (totalPages > 1) {
    if (page > 0) {
      nav.push({
        text: "← Prev",
        callback_data: encodeCallback(
          POSITIONS_PAGE_CALLBACK_CMD,
          String(page - 1),
          wallet,
        ),
      });
    }
    if (page < totalPages - 1) {
      nav.push({
        text: "Next →",
        callback_data: encodeCallback(
          POSITIONS_PAGE_CALLBACK_CMD,
          String(page + 1),
          wallet,
        ),
      });
    }
  }
  if (nav.length > 0) rows.push(nav);
  rows.push(backHomeRow());
  return { inline_keyboard: rows };
};
