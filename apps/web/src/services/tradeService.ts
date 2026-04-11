import {
  BOUNCE_INDEXING_API,
  type LiveLeveragedToken,
} from "@launchpad/shared";
import { formatUnits } from "viem";

import { fetchComments } from "./api";
import {
  generateFeedTrade,
  generateTokenTrade,
  INITIAL_TOKEN_TRADES,
  MOCK_HOLDERS,
} from "./mock/trades";
import { fetchPonderToken, fetchPonderTrades } from "./ponder";

import type { Comment, Holder, Trade } from "./types";

function formatTokenBalance(raw: string): string {
  const whole = Number(formatUnits(BigInt(raw), 18));
  if (whole >= 1_000_000_000) return (whole / 1_000_000_000).toFixed(1) + "B";
  if (whole >= 1_000_000) return (whole / 1_000_000).toFixed(1) + "M";
  if (whole >= 1_000) return (whole / 1_000).toFixed(1) + "K";
  return whole.toFixed(1);
}

// LT address → exchange rate (USD per LT, as a float)
let ltRateCache = new Map<string, number>();
let ltRateCacheTime = 0;
const LT_RATE_CACHE_TTL = 60_000;

async function getLtExchangeRates(): Promise<Map<string, number>> {
  if (Date.now() - ltRateCacheTime < LT_RATE_CACHE_TTL && ltRateCache.size > 0) {
    return ltRateCache;
  }
  const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`);
  const lts = (await res.json()) as LiveLeveragedToken[];
  const rates = new Map<string, number>();
  for (const lt of lts) {
    rates.set(lt.address.toLowerCase(), parseFloat(formatUnits(BigInt(lt.exchangeRate), 18)));
  }
  ltRateCache = rates;
  ltRateCacheTime = Date.now();
  return rates;
}

// tokenAddress → ltAddress (lowercase)
const tokenLtMap = new Map<string, string>();

async function getLtAddressForToken(tokenAddress: string): Promise<string | undefined> {
  const key = tokenAddress.toLowerCase();
  const cached = tokenLtMap.get(key);
  if (cached) return cached;

  const token = await fetchPonderToken(tokenAddress);
  if (token) {
    const ltAddr = token.ltToken.toLowerCase();
    tokenLtMap.set(key, ltAddr);
    return ltAddr;
  }
  return undefined;
}

async function resolveExchangeRate(tokenAddress: string): Promise<number> {
  const [rates, ltAddr] = await Promise.all([
    getLtExchangeRates(),
    getLtAddressForToken(tokenAddress),
  ]);
  if (ltAddr) {
    return rates.get(ltAddr) ?? 1;
  }
  return 1;
}

interface PonderTradeInput {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  ltAmount: string;
  tokenAmount: string;
  timestamp: string;
}

function ponderTradeToTrade(pt: PonderTradeInput, exchangeRate: number): Trade {
  const ltAmountFloat = parseFloat(formatUnits(BigInt(pt.ltAmount), 18));

  return {
    id: pt.id,
    side: pt.isBuy ? "BUY" : "SELL",
    amountUsd: ltAmountFloat * exchangeRate,
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
    const interval = setInterval(() => void poll(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  getInitialTrades(address) {
    void address;
    if (import.meta.env.DEV) {
      return [...INITIAL_TOKEN_TRADES];
    }
    return [];
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

  async getHolders(address) {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";
      const res = await fetch(`${API_BASE}/api/v1/holders/${address}`);
      const json = (await res.json()) as {
        status: string;
        data: {
          holders: { wallet: string; balance: string; percentage: number }[];
          totalHolders: number;
        } | null;
      };
      if (json.status !== "success" || !json.data) throw new Error("No data");
      return json.data.holders.map((h, i) => ({
        rank: i + 1,
        address: `${h.wallet.slice(0, 4)}…${h.wallet.slice(-2)}`,
        tokens: formatTokenBalance(h.balance),
        percentSupply: h.percentage,
        isCreator: false,
      }));
    } catch {
      if (import.meta.env.DEV) {
        return [...MOCK_HOLDERS];
      }
      return [];
    }
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
