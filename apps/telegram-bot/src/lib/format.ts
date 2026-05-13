import type {
  BotOpenPosition,
  BotPositionsResponse,
  BotRealisedPosition,
} from "./api.js";
import { encodeCallback } from "./callbacks.js";

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
 * Build the inline `Buy` / `Sell` HTML link pair that follows the
 * value/PnL row of every open position. The links point at the bot's
 * own `t.me` deeplink with a `buy_<addr>` / `sell_<addr>` `start`
 * payload — tapping the text returns the user to the bot chat and
 * fires `/start <payload>`, which the start handler routes to a fresh
 * buy/sell card for the selected token (see `commands/start.ts`).
 *
 * Inline HTML anchors replace the bottom-of-message keyboard rows
 * that this command used to emit, so the actions live next to the
 * position they apply to instead of stacking at the end of the
 * message.
 */
const formatBuySellLinks = (token: string, botUsername: string): string => {
  const buy = `https://t.me/${botUsername}?start=buy_${token}`;
  const sell = `https://t.me/${botUsername}?start=sell_${token}`;
  return ` · <a href="${escapeHtml(buy)}">Buy</a> · <a href="${escapeHtml(sell)}">Sell</a>`;
};

const formatOpenLine = (
  pos: BotOpenPosition,
  limit: number,
  botUsername: string,
): string => {
  const labelRaw = escapeHtml(pos.ticker);
  const actions = formatBuySellLinks(pos.token, botUsername);
  const suffix =
    `\n  ${formatTokenAmount(pos.balance)} · cost $${formatUsdc(pos.costBasisUsdc)}` +
    `\n  value $${formatUsdc(pos.currentValueUsdc)} · PnL ${formatSignedUsdc(pos.unrealisedPnlUsdc)} (${formatPct(pos.unrealisedPnlPct)})${actions}`;
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
 * Render the bot-positions response as a list of paginated chunks. Open
 * and Realised sections share one paginated stream: Open header +
 * lines first, then Realised header + lines if any closed-out chunks
 * exist. The 4096-char-per-chunk limit and the pagination-footer
 * reservation match `formatPositionsResponse`.
 *
 * Each open-position line carries inline `Buy` / `Sell` HTML links
 * pointing at the bot's `t.me?start=buy_<addr>` / `sell_<addr>`
 * deeplinks — tapping returns the user to the bot chat and fires
 * `/start <payload>`, which routes to a fresh buy/sell card for the
 * selected token. The reply must be sent with `parse_mode: "HTML"`.
 */
export const formatBotPositionsResponse = (
  data: BotPositionsResponse,
  botUsername: string,
): string[] => {
  if (data.open.length === 0 && data.realised.length === 0) {
    return ["No open positions for this wallet."];
  }
  const limit = TELEGRAM_MESSAGE_LIMIT - PAGINATION_FOOTER_BUDGET;
  const lines: string[] = [];
  let header = "";
  if (data.open.length > 0) {
    header = `Open positions (${data.open.length})`;
    for (const p of data.open) lines.push(formatOpenLine(p, limit, botUsername));
  }
  if (data.realised.length > 0) {
    const realisedHeader = `Realised positions (${data.realised.length})`;
    if (header === "") header = realisedHeader;
    else lines.push(realisedHeader);
    for (const p of data.realised) lines.push(formatRealisedLine(p, limit));
  }
  return chunkPositionsMessage(header, lines, limit);
};

export const POSITIONS_PAGE_CALLBACK_CMD = "pp";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Render one page of a chunked positions response. A multi-page reply
 * gets a `Page X/Y` footer so the user knows where they are; a single
 * page renders verbatim. The keyboard handles navigation — see
 * `buildPositionsPageKeyboard` for the matching nav row.
 */
export const renderPaginatedPage = (
  chunks: string[],
  page: number,
): string => {
  if (chunks.length === 0) return "";
  const safePage = Math.max(0, Math.min(page, chunks.length - 1));
  const body = chunks[safePage]!;
  if (chunks.length === 1) return body;
  return `${body}\n\nPage ${safePage + 1} of ${chunks.length}`;
};

/**
 * Build the `[← Prev] [Next →]` row that travels with a multi-page
 * positions reply. Returns `null` for single-page outputs so the
 * caller can omit `reply_markup` entirely — sending an empty keyboard
 * would render an awkward zero-height bar in the Telegram client.
 *
 * The wallet rides in `callback_data` (not in server-side state) so
 * the bot can survive Worker cold-starts and re-deploys without
 * needing a KV-backed page cache. Recomputing on each click is cheap
 * over the service binding.
 */
export const buildPositionsPageKeyboard = (
  page: number,
  totalPages: number,
  wallet: string,
): InlineKeyboardMarkup | null => {
  const rows: InlineKeyboardButton[][] = [];
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
  return rows.length > 0 ? { inline_keyboard: rows } : null;
};
