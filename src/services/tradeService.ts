import {
  generateFeedTrade,
  generateTokenTrade,
  INITIAL_TOKEN_TRADES,
  MOCK_COMMENTS,
  MOCK_HOLDERS,
} from "./mock/trades";

import type { Trade, Comment, Holder } from "./types";

export interface ITradeService {
  subscribeFeed(cb: (trade: Trade) => void): () => void;
  subscribeTokenTrades(address: string, cb: (trade: Trade) => void): () => void;
  getInitialTrades(address: string): Trade[];
  getComments(address: string): Promise<Comment[]>;
  getHolders(address: string): Promise<Holder[]>;
}

const mockTradeService: ITradeService = {
  subscribeFeed(cb) {
    for (let i = 0; i < 8; i++) {
      setTimeout(() => cb(generateFeedTrade()), i * 150);
    }
    const interval = setInterval(() => cb(generateFeedTrade()), 500);
    return () => clearInterval(interval);
  },

  subscribeTokenTrades(_address, cb) {
    const interval = setInterval(() => cb(generateTokenTrade()), 1200);
    return () => clearInterval(interval);
  },

  getInitialTrades(_address) {
    return [...INITIAL_TOKEN_TRADES];
  },

  async getComments(_address) {
    return [...MOCK_COMMENTS];
  },

  async getHolders(_address) {
    return [...MOCK_HOLDERS];
  },
};

export const tradeService: ITradeService = mockTradeService;
