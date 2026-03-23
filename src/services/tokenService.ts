import type { Token, TokenFilter } from './types';
import { MOCK_TOKENS } from './mock/tokens';

export interface ITokenService {
  getTokens(filter?: TokenFilter): Promise<Token[]>;
  getToken(address: string): Promise<Token | undefined>;
  getLongTokens(filter?: TokenFilter): Promise<Token[]>;
  getShortTokens(filter?: TokenFilter): Promise<Token[]>;
}

function jitter(value: number, pct = 0.05): number {
  return value * (1 + (Math.random() * 2 - 1) * pct);
}

const mockTokenService: ITokenService = {
  async getTokens(filter?: TokenFilter) {
    let tokens = MOCK_TOKENS.map((t) => ({
      ...t,
      mcapUsd: jitter(t.mcapUsd),
      change24h: +(t.change24h + (Math.random() * 4 - 2)).toFixed(1),
    }));
    switch (filter) {
      case 'graduating':
        tokens = tokens.filter((t) => t.status === 'graduating');
        break;
      case 'graduated':
        tokens = tokens.filter((t) => t.status === 'graduated');
        break;
      case 'new':
        tokens = tokens.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case 'lt-movers':
        tokens = tokens
          .filter((t) => t.leverageBoost > 0)
          .sort((a, b) => b.leverageBoost - a.leverageBoost);
        break;
      case 'trending':
      default: {
        const graduated = tokens.filter((t) => t.status === 'graduated');
        const active = tokens.filter((t) => t.status !== 'graduated');
        active.sort((a, b) => b.mcapUsd - a.mcapUsd);
        const king = graduated.sort((a, b) => b.mcapUsd - a.mcapUsd)[0];
        tokens = king ? [king, ...active] : active;
        break;
      }
    }
    return tokens;
  },

  async getToken(address: string) {
    return MOCK_TOKENS.find((t) => t.address === address);
  },

  async getLongTokens(filter?: TokenFilter) {
    const tokens = await this.getTokens(filter);
    return tokens.filter((t) => t.direction === 'long');
  },

  async getShortTokens(filter?: TokenFilter) {
    const tokens = await this.getTokens(filter);
    return tokens.filter((t) => t.direction === 'short');
  },
};

export const tokenService: ITokenService = mockTokenService;
