import { fetchComments, fetchHolders } from "./api";
import { subscribeFeed, subscribeTokenTrades } from "./tradeFeed";
import { formatTokenBalance } from "./tradeFormatter";
import { formatTimeAgo } from "../utils/format";

import type { Comment, Holder, Trade } from "./types";

export type { PonderTradeInput } from "./tradeFormatter";
export { getLtExchangeRates, resolveExchangeRate } from "./exchangeRates";
export { formatTokenBalance, ponderTradeToTrade } from "./tradeFormatter";
export { subscribeFeed, subscribeTokenTrades } from "./tradeFeed";

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
  subscribeFeed,

  subscribeTokenTrades,

  getInitialTrades(_address) {
    void _address;
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
      const { holders } = await fetchHolders(address);
      return holders.map((h, i) => ({
        rank: i + 1,
        address: `${h.wallet.slice(0, 4)}…${h.wallet.slice(-2)}`,
        tokens: formatTokenBalance(h.balance),
        percentSupply: h.percentage,
        isCreator: false,
      }));
    } catch {
      return [];
    }
  },
};


export const tradeService: ITradeService = liveTradeService;
