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

const formatOpenLine = (pos: BotOpenPosition, limit: number): string => {
  const labelRaw = `${pos.ticker}`;
  const suffix =
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
  const labelRaw = `${pos.ticker}`;
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
 * One rendered page of the positions reply: the text body plus the
 * subset of open positions whose lines are visible on that page. The
 * `openPositions` list drives the per-position [Buy] [Sell] rows the
 * page keyboard emits — only positions visible on the current page
 * get buttons so the keyboard stays aligned with the body.
 */
export interface PositionsChunk {
  text: string;
  openPositions: BotOpenPosition[];
}

interface TaggedLine {
  text: string;
  openPos?: BotOpenPosition;
}

/**
 * Chunker variant of `chunkPositionsMessage` that propagates per-line
 * `openPos` tags so each emitted chunk also exposes which open
 * positions landed in it. Same packing rules and footer reservation
 * as the untagged chunker — kept separate to avoid churning the
 * existing string-array helper used by the test suite.
 */
const chunkTaggedLines = (
  header: string,
  lines: TaggedLine[],
  limit: number,
): PositionsChunk[] => {
  if (lines.length === 0) return [{ text: header, openPositions: [] }];
  const chunks: PositionsChunk[] = [];
  let currentText = header;
  let currentOpen: BotOpenPosition[] = [];
  for (const line of lines) {
    const joiner = currentText === "" ? "" : "\n\n";
    if (currentText.length + joiner.length + line.text.length > limit) {
      if (currentText !== "")
        chunks.push({ text: currentText, openPositions: currentOpen });
      currentText = line.text;
      currentOpen = line.openPos ? [line.openPos] : [];
      continue;
    }
    currentText =
      currentText === "" ? line.text : `${currentText}${joiner}${line.text}`;
    if (line.openPos) currentOpen.push(line.openPos);
  }
  if (currentText !== "")
    chunks.push({ text: currentText, openPositions: currentOpen });
  return chunks;
};

/**
 * Render the bot-positions response as a list of paginated chunks. Open
 * and Realised sections share one paginated stream: Open header +
 * lines first, then Realised header + lines if any closed-out chunks
 * exist. The 4096-char-per-chunk limit and the pagination-footer
 * reservation match `formatPositionsResponse`.
 *
 * Each chunk also exposes the open positions whose lines are visible
 * on it (`openPositions`). The `/positions` command uses that list to
 * build per-position [Buy] [Sell] callback rows aligned with the
 * lines actually rendered on the page.
 */
export const formatBotPositionsResponse = (
  data: BotPositionsResponse,
): PositionsChunk[] => {
  if (data.open.length === 0 && data.realised.length === 0) {
    return [
      { text: "No open positions for this wallet.", openPositions: [] },
    ];
  }
  const limit = TELEGRAM_MESSAGE_LIMIT - PAGINATION_FOOTER_BUDGET;
  const lines: TaggedLine[] = [];
  if (data.open.length > 0) {
    lines.push({ text: `Open positions (${data.open.length})` });
    for (const p of data.open)
      lines.push({ text: formatOpenLine(p, limit), openPos: p });
  }
  if (data.realised.length > 0) {
    lines.push({ text: `Realised positions (${data.realised.length})` });
    for (const p of data.realised)
      lines.push({ text: formatRealisedLine(p, limit) });
  }
  // First line becomes the chunk header so a section header always
  // sticks with the lines below it when chunking spills.
  const [header, ...body] = lines;
  return chunkTaggedLines(header?.text ?? "", body, limit);
};

export const POSITIONS_PAGE_CALLBACK_CMD = "pp";

/**
 * Per-open-position callback codes emitted by `/positions`. Each pairs
 * with a token address (3+1+42 = 46 bytes, safely under the 64-byte
 * `callback_data` budget). Handlers in `commands/positions.ts` open a
 * fresh buy/sell card for the selected token — mirrors `/track`'s
 * `trkb` / `trks` pattern but keeps the wiring local so the positions
 * UI doesn't reach across commands.
 */
export const POSITION_BUY_CALLBACK_CMD = "pob";
export const POSITION_SELL_CALLBACK_CMD = "pos";

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
  openPositions: readonly BotOpenPosition[] = [],
): InlineKeyboardMarkup | null => {
  const rows: InlineKeyboardButton[][] = [];
  for (const pos of openPositions) {
    rows.push([
      {
        text: `Buy ${pos.ticker}`,
        callback_data: encodeCallback(POSITION_BUY_CALLBACK_CMD, pos.token),
      },
      {
        text: `Sell ${pos.ticker}`,
        callback_data: encodeCallback(POSITION_SELL_CALLBACK_CMD, pos.token),
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
  return rows.length > 0 ? { inline_keyboard: rows } : null;
};
