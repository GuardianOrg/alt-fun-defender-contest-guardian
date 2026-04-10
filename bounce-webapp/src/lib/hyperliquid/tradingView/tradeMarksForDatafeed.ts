import { getLeverageTokenSymbol } from "../../../utils/getLeverageTokenSymbol.util";

import type {
  Mark,
  MarkCustomColor,
} from "../../../../public/charting_library/datafeed-api";
import type { Trade } from "../../../hooks/Indexer/useTrades";

/** TradingView allows at most 10 marks per bar (datafeed contract). */
export const MAX_MARKS_PER_BAR = 10;

const MINT_GREEN: MarkCustomColor = {
  border: "#52be60",
  background: "#52be60",
};

const REDEEM_RED: MarkCustomColor = {
  border: "#f76960",
  background: "#f76960",
};

export function tradeTimestampToUnixSeconds(ts: number): number {
  if (!Number.isFinite(ts)) return 0;
  if (ts > 1e12) return Math.floor(ts / 1000);
  return Math.floor(ts);
}

export function alignTradeToBarOpenMs(
  tradeTimestampSec: number,
  intervalMs: number,
): number {
  const tradeMs = tradeTimestampSec * 1000;
  return Math.floor(tradeMs / intervalMs) * intervalMs;
}

export function markTimeSecFromBarOpenMs(barOpenMs: number): number {
  return Math.floor(barOpenMs / 1000);
}

export function isMarkInVisibleRange(
  markTimeSec: number,
  fromSec: number,
  toSec: number,
): boolean {
  return markTimeSec >= fromSec && markTimeSec <= toSec;
}

export type BuildDatafeedMarksParams = {
  trades: Trade[];
  coin: string;
  fromSec: number;
  toSec: number;
  intervalMs: number;
};

function hoverText(tokenSym: string, isBuy: boolean): string {
  return isBuy ? `Minted ${tokenSym}` : `Redeemed ${tokenSym}`;
}

export function buildDatafeedMarksFromTrades(
  p: BuildDatafeedMarksParams,
): Mark[] {
  const relevant = p.trades.filter((t) => t.targetAsset === p.coin);
  const sorted = [...relevant].sort(
    (a, b) =>
      tradeTimestampToUnixSeconds(a.timestamp) -
      tradeTimestampToUnixSeconds(b.timestamp),
  );

  type Row = { trade: Trade; barOpenMs: number; markTimeSec: number };
  const byBar = new Map<number, Row[]>();
  for (const trade of sorted) {
    const barOpenMs = alignTradeToBarOpenMs(
      tradeTimestampToUnixSeconds(trade.timestamp),
      p.intervalMs,
    );
    const markTimeSec = markTimeSecFromBarOpenMs(barOpenMs);
    if (!isMarkInVisibleRange(markTimeSec, p.fromSec, p.toSec)) continue;
    const row: Row = { trade, barOpenMs, markTimeSec };
    const list = byBar.get(barOpenMs) ?? [];
    list.push(row);
    byBar.set(barOpenMs, list);
  }

  const capped: Row[] = [];
  for (const [, list] of byBar) {
    capped.push(...list.slice(-MAX_MARKS_PER_BAR));
  }
  capped.sort((a, b) => {
    const ta = tradeTimestampToUnixSeconds(a.trade.timestamp);
    const tb = tradeTimestampToUnixSeconds(b.trade.timestamp);
    if (ta !== tb) return ta - tb;
    return String(a.trade.id).localeCompare(String(b.trade.id));
  });

  return capped.map((row) => {
    const { trade } = row;
    const tokenSym = getLeverageTokenSymbol(
      trade.targetAsset,
      trade.targetLeverage,
      trade.isLong ? "long" : "short",
    );
    const isBuy = trade.isBuy;
    return {
      id: `${trade.id}-${trade.timestamp}`,
      time: row.markTimeSec,
      color: isBuy ? MINT_GREEN : REDEEM_RED,
      text: hoverText(tokenSym, isBuy),
      label: isBuy ? "B" : "S",
      labelFontColor: "#ffffff",
      minSize: 16,
    };
  });
}
