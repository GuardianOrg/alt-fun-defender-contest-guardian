import type { BalanceEntry, PortfolioPosition } from "./api.js";

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
 * Truncate the label so the rendered line always fits below
 * `TELEGRAM_MESSAGE_LIMIT`. A pathological token name (the indexer doesn't
 * cap them) would otherwise produce a single line longer than the chunker
 * can split, and Telegram would silent-400 the reply.
 */
export const formatPositionLine = (pos: JoinedPosition): string => {
  const suffix = `\n  ${formatTokenAmount(pos.amount)} · cost basis $${formatUsdc(pos.costBasisUsdc)}`;
  const budget = TELEGRAM_MESSAGE_LIMIT - LINE_PREFIX.length - suffix.length;
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

export const formatPositionsResponse = (
  positions: JoinedPosition[],
  options: { approximate: boolean },
): string[] => {
  if (positions.length === 0) {
    return ["No open positions for this wallet."];
  }
  const header = `Open positions (${positions.length})`;
  const lines = positions.map(formatPositionLine);
  const chunks = chunkPositionsMessage(header, lines);
  if (options.approximate) {
    const note =
      "\n\nList truncated at 1000 positions — query indexer directly for the full set.";
    const last = chunks[chunks.length - 1]!;
    if (last.length + note.length <= TELEGRAM_MESSAGE_LIMIT) {
      chunks[chunks.length - 1] = `${last}${note}`;
    } else {
      chunks.push(note.trimStart());
    }
  }
  return chunks;
};
