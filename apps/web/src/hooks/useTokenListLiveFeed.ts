import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { createTradeFeedInvalidator } from "./useTokenLiveFeed";
import { getWebSocketClient } from "../services/websocket";

import type { TradeBroadcast } from "../services/types";

// Global trade channel is hot; coalesce catalogue and market-data invalidations.
const INVALIDATE_THROTTLE_MS = 1_000;

/** Variant-blind trade update predicate; exported for malformed-payload tests. */
export function isListLiveTradeUpdate(raw: TradeBroadcast): boolean {
  return (
    typeof raw.tokenAddress === "string" && raw.tokenAddress.trim().length > 0
  );
}

/** Subscribe to the global trade shard and invalidate list-level read models. */
export function useTokenListLiveFeed(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const ws = getWebSocketClient();
    if (!ws) return;

    const invalidator = createTradeFeedInvalidator(() => {
      // One cache namespace covers table, search, right panel, and dev simulator.
      queryClient.invalidateQueries({ queryKey: ["tokens-infinite"] });
      // Single market-data query covers mcap, 24h change, and 24h volume.
      queryClient.invalidateQueries({ queryKey: ["market-data"] });
    }, INVALIDATE_THROTTLE_MS);

    const unsub = ws.subscribe("trade", (data) => {
      // Defend before reading `.tokenAddress` from unknown WS data.
      if (data === null || typeof data !== "object") return;
      const raw = data as TradeBroadcast;
      if (!isListLiveTradeUpdate(raw)) return;
      invalidator.handle();
    });

    return () => {
      unsub();
      invalidator.dispose();
    };
  }, [queryClient]);
}
