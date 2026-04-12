import { resolveExchangeRate } from "./exchangeRates";
import {
  generateFeedTrade,
  generateTokenTrade,
} from "./mock/trades";
import { fetchPonderTrades } from "./ponder";
import { ponderTradeToTrade } from "./tradeFormatter";
import { getWebSocketClient } from "./websocket";

import type { Trade } from "./types";

export function subscribeFeed(cb: (trade: Trade) => void): () => void {
  const ws = getWebSocketClient();
  let unsubWs: (() => void) | null = null;
  const seenIds = new Set<string>();

  if (ws) {
    unsubWs = ws.subscribe("trade", (data) => {
      const trade = data as Trade;
      if (trade.id && !seenIds.has(trade.id)) {
        seenIds.add(trade.id);
        cb(trade);
      }
    });
  }

  let cancelled = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let hasLiveData = false;

  const poll = async (initial: boolean) => {
    if (cancelled || polling) return;
    polling = true;
    try {
      const trades = await fetchPonderTrades(undefined, 20);
      if (cancelled) return;

      const uniqueTokens = [...new Set(trades.map((t) => t.tokenAddress))];
      const rateEntries = await Promise.all(
        uniqueTokens.map(async (addr) => [addr, await resolveExchangeRate(addr)] as const),
      );
      const rateMap = new Map(rateEntries);

      const batchIds = new Set<string>();
      for (const t of trades) {
        batchIds.add(t.id);
        if (seenIds.has(t.id)) continue;
        cb(ponderTradeToTrade(t, rateMap.get(t.tokenAddress) ?? 1));
      }
      seenIds.clear();
      for (const id of batchIds) seenIds.add(id);
      hasLiveData = true;
    } catch {
      if (!hasLiveData && initial && import.meta.env.DEV) {
        for (let i = 0; i < 8; i++) {
          if (cancelled) return;
          cb(generateFeedTrade());
        }
      }
    } finally {
      polling = false;
    }
  };

  void poll(true);
  const schedulePoll = () => {
    if (cancelled) return;
    pollTimer = setTimeout(() => {
      void poll(false).finally(schedulePoll);
    }, ws?.isConnected ? 15_000 : 3_000);
  };
  schedulePoll();

  return () => {
    cancelled = true;
    if (pollTimer) clearTimeout(pollTimer);
    unsubWs?.();
  };
}

export function subscribeTokenTrades(
  address: string,
  cb: (trade: Trade) => void,
): () => void {
  const ws = getWebSocketClient();
  let unsubWs: (() => void) | null = null;
  const seenIds = new Set<string>();

  const normalizedAddress = address.toLowerCase();
  if (ws) {
    unsubWs = ws.subscribe("trade", (data) => {
      const trade = data as Trade;
      if (trade.id && !seenIds.has(trade.id) && trade.tokenAddress?.toLowerCase() === normalizedAddress) {
        seenIds.add(trade.id);
        cb(trade);
      }
    }, normalizedAddress);
  }

  let cancelled = false;
  let polling = false;
  let hasLiveData = false;

  const poll = async () => {
    if (cancelled || polling) return;
    polling = true;
    try {
      const [trades, exchangeRate] = await Promise.all([
        fetchPonderTrades(address, 30),
        resolveExchangeRate(address),
      ]);
      if (cancelled) return;
      const batchIds = new Set<string>();
      for (const t of trades) {
        batchIds.add(t.id);
        if (seenIds.has(t.id)) continue;
        cb(ponderTradeToTrade(t, exchangeRate));
      }
      seenIds.clear();
      for (const id of batchIds) seenIds.add(id);
      hasLiveData = true;
    } catch {
      if (!hasLiveData && !cancelled && import.meta.env.DEV) {
        cb(generateTokenTrade());
      }
    } finally {
      polling = false;
    }
  };

  void poll();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedulePoll = () => {
    if (cancelled) return;
    timer = setTimeout(() => {
      void poll().finally(schedulePoll);
    }, ws?.isConnected ? 15_000 : 5_000);
  };
  schedulePoll();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubWs?.();
  };
}
