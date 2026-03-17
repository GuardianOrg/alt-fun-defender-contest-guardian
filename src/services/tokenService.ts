import type { Token, TokenFilter } from './types';
import { MOCK_TOKENS } from './mock/tokens';

export interface ITokenService {
  getTokens(filter?: TokenFilter): Promise<Token[]>;
  getToken(address: string): Promise<Token | undefined>;
  getLongTokens(filter?: TokenFilter): Promise<Token[]>;
  getShortTokens(filter?: TokenFilter): Promise<Token[]>;
}

const mockTokenService: ITokenService = {
  async getTokens(filter?: TokenFilter) {
    let tokens = [...MOCK_TOKENS];
    switch (filter) {
      case 'graduating':
        tokens = tokens.filter((t) => t.status === 'graduating');
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
      default:
        tokens = tokens.sort((a, b) => b.change24h - a.change24h);
        break;
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
