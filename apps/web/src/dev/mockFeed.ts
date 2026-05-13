import type { Token, Trade } from "../services/types";

/**
 * Dev-only in-process event bus for the "simulate trades / tokens"
 * easter egg. The `DevSimulator` panel pushes fabricated rows into the
 * bus via `emitMockTrade` / `emitMockToken`; the live-feed hooks
 * (`useTradeFeed`, `useTokenTrades`, `useInfiniteTokens`) subscribe to
 * those streams in dev mode and merge the rows into their state as if
 * they had arrived from the WS / REST poll path.
 *
 * Production builds wire up the subscriptions behind
 * `import.meta.env.DEV`, so this module is dead-code-eliminated on
 * `vite build` — the bus is fully inert in the deployed app and there
 * is no way to emit into it without an injected dev console call.
 */

type TradeListener = (trade: Trade) => void;
type TokenListener = (token: Token) => void;

const tradeListeners = new Set<TradeListener>();
const tokenListeners = new Set<TokenListener>();

export function subscribeMockTrades(cb: TradeListener): () => void {
  tradeListeners.add(cb);
  return () => {
    tradeListeners.delete(cb);
  };
}

export function emitMockTrade(trade: Trade): void {
  for (const cb of tradeListeners) cb(trade);
}

export function subscribeMockTokens(cb: TokenListener): () => void {
  tokenListeners.add(cb);
  return () => {
    tokenListeners.delete(cb);
  };
}

export function emitMockToken(token: Token): void {
  for (const cb of tokenListeners) cb(token);
}
