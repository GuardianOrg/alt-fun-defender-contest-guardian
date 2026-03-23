import { useState, useEffect } from "react";

import { tradeService } from "../services/tradeService";

import type { Trade } from "../services/types";

export function useTradeFeed(maxItems = 14) {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    const unsub = tradeService.subscribeFeed((trade) => {
      setTrades((prev) => [trade, ...prev].slice(0, maxItems));
    });
    return () => unsub();
  }, [maxItems]);

  return trades;
}

export function useTokenTrades(address: string | undefined, maxItems = 30) {
  const [trades, setTrades] = useState<Trade[]>(() =>
    address ? tradeService.getInitialTrades(address) : [],
  );

  useEffect(() => {
    if (!address) return;
    setTrades(tradeService.getInitialTrades(address));
    const unsub = tradeService.subscribeTokenTrades(address, (trade) => {
      setTrades((prev) => [trade, ...prev].slice(0, maxItems));
    });
    return () => unsub();
  }, [address, maxItems]);

  return trades;
}
