import type { Token, Trade } from "../services/types";

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
