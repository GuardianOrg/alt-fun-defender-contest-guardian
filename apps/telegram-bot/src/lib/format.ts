import type { BalanceEntry, PortfolioPosition } from "./api.js";
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

export interface JoinedPosition {
  address: string;
  label: string;
  amount: string;
  costBasisUsdc: string;
}

/**
 * Join portfolio (cost basis) with balances (name/ticker). Both endpoints
 * are scoped to Alt Fun tokens, so the join is the source of truth for
 * which positions to surface — direct-transfer-only tokens (no Zap activity)
 * still show with cost basis 0, matching the indexer semantics in
 * `apps/api/src/routes/portfolio.ts`.
 */
export const joinPositions = (
  portfolio: PortfolioPosition[],
  balances: BalanceEntry[],
): JoinedPosition[] => {
  const costBasisByAddr = new Map<string, string>();
  for (const p of portfolio) {
    costBasisByAddr.set(p.tokenAddress.toLowerCase(), p.costBasisUsdc);
  }
  return balances.map((b) => {
    const lower = b.address.toLowerCase();
    return {
      address: b.address,
      label: `${b.name} (${b.ticker})`,
      amount: b.balance,
      costBasisUsdc: costBasisByAddr.get(lower) ?? "0",
    };
  });
};

const LINE_PREFIX = "• ";

/**
 * Truncate the label so the rendered line always fits below the
 * chunker's effective limit. Callers that paginate must pass the
 * reduced limit (`TELEGRAM_MESSAGE_LIMIT - PAGINATION_FOOTER_BUDGET`)
 * — otherwise a line in `(limit, TELEGRAM_MESSAGE_LIMIT]` slips past
 * line truncation and ends up as a single oversized chunk, which the
 * paginator's footer can then push over Telegram's 4096-char ceiling.
 */
export const formatPositionLine = (
  pos: JoinedPosition,
  limit: number = TELEGRAM_MESSAGE_LIMIT,
): string => {
  const suffix = `\n  ${formatTokenAmount(pos.amount)} · cost basis $${formatUsdc(pos.costBasisUsdc)}`;
  const budget = limit - LINE_PREFIX.length - suffix.length;
  const label =
    pos.label.length > budget
      ? `${pos.label.slice(0, Math.max(1, budget - 1))}…`
      : pos.label;
  return `${LINE_PREFIX}${label}${suffix}`;
};

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

export const formatPositionsResponse = (
  positions: JoinedPosition[],
  options: { approximate: boolean },
): string[] => {
  if (positions.length === 0) {
    return ["No open positions for this wallet."];
  }
  const header = `Open positions (${positions.length})`;
  // Tighter limit reserves room for the multi-page footer. Single-page
  // outputs effectively waste those bytes, but the cost is dwarfed by
  // the silent-400 risk if a maxed chunk + footer overflows. Same
  // budget feeds back into formatPositionLine so pathological labels
  // are pre-truncated against the chunker's actual ceiling, not the
  // raw 4096-char Telegram limit.
  const limit = TELEGRAM_MESSAGE_LIMIT - PAGINATION_FOOTER_BUDGET;
  const lines = positions.map((p) => formatPositionLine(p, limit));
  const chunks = chunkPositionsMessage(header, lines, limit);
  if (options.approximate) {
    const note =
      "\n\nList truncated at 1000 positions — query indexer directly for the full set.";
    const last = chunks[chunks.length - 1]!;
    if (last.length + note.length <= limit) {
      chunks[chunks.length - 1] = `${last}${note}`;
    } else {
      chunks.push(note.trimStart());
    }
  }
  return chunks;
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
  if (totalPages <= 1) return null;
  const row: InlineKeyboardButton[] = [];
  if (page > 0) {
    row.push({
      text: "← Prev",
      callback_data: encodeCallback(
        POSITIONS_PAGE_CALLBACK_CMD,
        String(page - 1),
        wallet,
      ),
    });
  }
  if (page < totalPages - 1) {
    row.push({
      text: "Next →",
      callback_data: encodeCallback(
        POSITIONS_PAGE_CALLBACK_CMD,
        String(page + 1),
        wallet,
      ),
    });
  }
  return { inline_keyboard: [row] };
};
