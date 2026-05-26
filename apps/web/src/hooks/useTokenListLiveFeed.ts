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
      // `cancelRefetch: false` so invalidations arriving while a fetch is
      // still in flight are absorbed by that in-flight fetch rather than
      // aborting it and starting another. Without this, an API that
      // responds slower than the 1s throttle window would never settle —
      // every WS tick would cancel and restart the request before it
      // could complete. See PR #1157 for the orphaned-request pile-up
      // this also fixes when threaded with the AbortSignal plumbing.
      queryClient.invalidateQueries(
        // One cache namespace covers table, search, right panel, and dev simulator.
        { queryKey: ["tokens-infinite"] },
        { cancelRefetch: false },
      );
      queryClient.invalidateQueries(
        // Single market-data query covers mcap, 24h change, and 24h volume.
        { queryKey: ["market-data"] },
        { cancelRefetch: false },
      );
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
