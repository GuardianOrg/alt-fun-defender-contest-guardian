import { useState, useEffect, useRef } from 'react';
import type { Trade } from '@/services/types';
import { tradeService } from '@/services/tradeService';

export function useTradeFeed(maxItems = 14) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubRef.current = tradeService.subscribeFeed((trade) => {
      setTrades((prev) => [trade, ...prev].slice(0, maxItems));
    });
    return () => unsubRef.current?.();
  }, [maxItems]);

  return trades;
}

export function useTokenTrades(address: string | undefined, maxItems = 30) {
  const [trades, setTrades] = useState<Trade[]>(() =>
    address ? tradeService.getInitialTrades(address) : [],
  );
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!address) return;
    setTrades(tradeService.getInitialTrades(address));
    unsubRef.current = tradeService.subscribeTokenTrades(address, (trade) => {
      setTrades((prev) => [trade, ...prev].slice(0, maxItems));
    });
    return () => unsubRef.current?.();
  }, [address, maxItems]);

  return trades;
}
