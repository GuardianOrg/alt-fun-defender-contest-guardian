import { formatUnits } from "viem";

import { fetchComments } from "./api";
import {
  generateFeedTrade,
  generateTokenTrade,
  INITIAL_TOKEN_TRADES,
  MOCK_HOLDERS,
} from "./mock/trades";
import { fetchPonderTrades } from "./ponder";

import type { Comment, Holder, Trade } from "./types";

function ponderTradeToTrade(pt: {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  ltAmount: string;
  tokenAmount: string;
  timestamp: string;
}): Trade {
  const ltAmountFloat = parseFloat(formatUnits(BigInt(pt.ltAmount), 18));

  return {
    id: pt.id,
    side: pt.isBuy ? "BUY" : "SELL",
    amountUsd: ltAmountFloat,
    tokensAmount: formatUnits(BigInt(pt.tokenAmount), 18),
    walletAddress: `${pt.trader.slice(0, 4)}…${pt.trader.slice(-2)}`,
    timestamp: new Date(Number(pt.timestamp) * 1000).toISOString(),
    tokenAddress: pt.tokenAddress,
    tokenName: "",
  };
}

export interface ITradeService {
  subscribeFeed(cb: (trade: Trade) => void): () => void;
  subscribeTokenTrades(
    address: string,
    cb: (trade: Trade) => void,
  ): () => void;
  getInitialTrades(address: string): Trade[];
  getComments(address: string): Promise<Comment[]>;
  getHolders(address: string): Promise<Holder[]>;
}

const liveTradeService: ITradeService = {
  subscribeFeed(cb) {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let polling = false;
    let hasLiveData = false;
    const seenIds = new Set<string>();

    const poll = async (initial: boolean) => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const trades = await fetchPonderTrades(undefined, 20);
        if (cancelled) return;
        for (const t of trades) {
          if (seenIds.has(t.id)) continue;
          seenIds.add(t.id);
          cb(ponderTradeToTrade(t));
        }
        hasLiveData = true;
      } catch {
        if (!hasLiveData && initial) {
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
    intervalId = setInterval(() => void poll(false), 3000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  },

  subscribeTokenTrades(address, cb) {
    let cancelled = false;
    let polling = false;
    let hasLiveData = false;
    const seenIds = new Set<string>();

    const poll = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const trades = await fetchPonderTrades(address, 30);
        if (cancelled) return;
        for (const t of trades) {
          if (seenIds.has(t.id)) continue;
          seenIds.add(t.id);
          cb(ponderTradeToTrade(t));
        }
        hasLiveData = true;
      } catch {
        if (!hasLiveData && !cancelled) {
          cb(generateTokenTrade());
        }
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  getInitialTrades(address) {
    void address;
    return [...INITIAL_TOKEN_TRADES];
  },

  async getComments(address) {
    try {
      const apiComments = await fetchComments(address);
      return apiComments.map((c) => ({
        id: String(c.id),
        emoji: "",
        address: `${c.author.slice(0, 4)}…${c.author.slice(-2)}`,
        timeAgo: formatTimeAgo(c.createdAt),
        text: c.content,
      }));
    } catch {
      return [];
    }
  },

  async getHolders(_address) {
    return [...MOCK_HOLDERS];
  },
};

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const tradeService: ITradeService = liveTradeService;
