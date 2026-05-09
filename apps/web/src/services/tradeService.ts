import { fetchHolders } from "./api";
import { subscribeFeed, subscribeTokenTrades } from "./tradeFeed";
import { formatTokenBalance } from "./tradeFormatter";

import type { Holder, Trade } from "./types";

export type { TradeBroadcast } from "./types";
export { formatTokenBalance } from "./tradeFormatter";
export { subscribeFeed, subscribeTokenTrades } from "./tradeFeed";

export interface ITradeService {
  subscribeFeed(cb: (trade: Trade) => void): () => void;
  subscribeTokenTrades(
    address: string,
    cb: (trade: Trade) => void,
  ): () => void;
  getInitialTrades(address: string): Trade[];
  getHolders(address: string): Promise<Holder[]>;
}

const liveTradeService: ITradeService = {
  subscribeFeed,

  subscribeTokenTrades,

  getInitialTrades(_address) {
    void _address;
    return [];
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
