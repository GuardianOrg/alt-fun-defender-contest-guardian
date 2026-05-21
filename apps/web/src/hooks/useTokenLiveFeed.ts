import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { getWebSocketClient } from "../services/websocket";

import type { TradeBroadcast } from "../services/types";

// Each trade can broadcast multiple payloads; coalesce token-detail invalidations.
const INVALIDATE_THROTTLE_MS = 1_000;

/** Defensive token-address gate for trade broadcasts; exported for edge-case tests. */
export function isLiveUpdateForToken(
  raw: TradeBroadcast,
  normalizedAddress: string,
): boolean {
  return raw.tokenAddress?.toLowerCase() === normalizedAddress;
}

export interface TradeFeedInvalidator {
  /** Forward a trade-channel hit through the throttle. */
  handle: () => void;
  /** Cancel any pending trailing fire — call on unsubscribe. */
  dispose: () => void;
}

/** Leading + trailing invalidation throttle; `now` is injectable for tests. */
export function createTradeFeedInvalidator(
  invalidate: () => void,
  throttleMs: number,
  now: () => number = Date.now,
): TradeFeedInvalidator {
  // Ensures the first call fires immediately, even under fake timers.
  let lastFiredAt = Number.NEGATIVE_INFINITY;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    lastFiredAt = now();
    invalidate();
  };

  return {
    handle: () => {
      const elapsed = now() - lastFiredAt;
      if (elapsed >= throttleMs) {
        // Quiet period: fire immediately and clear stale trailing work.
        if (trailingTimer) {
          clearTimeout(trailingTimer);
          trailingTimer = null;
        }
        fire();
        return;
      }
      // Inside the window: one trailing fire covers the burst.
      if (trailingTimer) return;
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        fire();
      }, throttleMs - elapsed);
    },
    dispose: () => {
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
    },
  };
}

/** Subscribe to token trade updates and invalidate the token-detail read model. */
export function useTokenLiveFeed(address: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address) return;
    const ws = getWebSocketClient();
    if (!ws) return;

    const normalized = address.toLowerCase();
    const invalidator = createTradeFeedInvalidator(() => {
      queryClient.invalidateQueries({ queryKey: ["token", address] });
    }, INVALIDATE_THROTTLE_MS);

    const unsub = ws.subscribe(
      "trade",
      (data) => {
        // Defend before reading `.tokenAddress` from unknown WS data.
        if (data === null || typeof data !== "object") return;
        const raw = data as TradeBroadcast;
        if (!isLiveUpdateForToken(raw, normalized)) return;
        invalidator.handle();
      },
      normalized,
    );

    return () => {
      unsub();
      invalidator.dispose();
    };
  }, [address, queryClient]);
}
