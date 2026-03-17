import type { CreatorEarnings, HeldToken } from './types';

export interface IProfileService {
  getBalances(walletAddress: string): Promise<HeldToken[]>;
  getEarnings(walletAddress: string): Promise<CreatorEarnings | null>;
  claimEarnings(walletAddress: string, tokenAddress?: string): Promise<string>;
}

const mockProfileService: IProfileService = {
  async getBalances(_walletAddress) {
    return [
      {
        address: '0x3f4a8b2c9d1e5f7a0000000000000001',
        name: 'MOONBOUND',
        ticker: 'MOON',
        emoji: '🚀',
        ltName: 'HYPE 3× Long',
        status: 'graduating' as const,
        amount: 4_210_000,
        valueUsd: 791.48,
        change24h: 24.1,
      },
      {
        address: '0x3f4a8b2c9d1e5f7a0000000000000002',
        name: 'HYPERAPE',
        ticker: 'HAPE',
        emoji: '🦍',
        ltName: 'HYPE 2× Long',
        status: 'active' as const,
        amount: 12_500_000,
        valueUsd: 312.5,
        change24h: -8.3,
      },
      {
        address: '0x3f4a8b2c9d1e5f7a0000000000000003',
        name: 'BEARISH',
        ticker: 'BEAR',
        emoji: '🐻',
        ltName: 'HYPE 2× Short',
        status: 'active' as const,
        amount: 800_000,
        valueUsd: 88.0,
        change24h: 5.6,
      },
      {
        address: '0x3f4a8b2c9d1e5f7a0000000000000006',
        name: 'HYPERCAT',
        ticker: 'HCAT',
        emoji: '🔥',
        ltName: 'HYPE 3× Long',
        status: 'active' as const,
        amount: 2_100_000,
        valueUsd: 42.0,
        change24h: 0.0,
      },
    ];
  },

  async getEarnings(_walletAddress) {
    return {
      totalEarned: 1204.6,
      totalClaimable: 842.4,
      totalClaimed: 362.2,
      tokens: [
        {
          address: '0x3f4a8b2c9d1e5f7a0000000000000001',
          name: 'MOONBOUND',
          emoji: '🚀',
          ltName: 'HYPE 3× Long',
          status: 'graduating' as const,
          curveFilled: 92,
          totalVolumeUsd: 84_000,
          feesEarnedUsd: 840,
          feesClaimableUsd: 620,
        },
        {
          address: '0x3f4a8b2c9d1e5f7a0000000000000006',
          name: 'HYPERCAT',
          emoji: '🔥',
          ltName: 'HYPE 3× Long',
          status: 'active' as const,
          curveFilled: 48,
          totalVolumeUsd: 4_800,
          feesEarnedUsd: 48,
          feesClaimableUsd: 32,
        },
        {
          address: '0x3f4a8b2c9d1e5f7a0000000000000004',
          name: 'HYPERVADER',
          emoji: '⚡',
          ltName: 'HYPE 2× Long',
          status: 'graduated' as const,
          curveFilled: 100,
          totalVolumeUsd: 340_000,
          feesEarnedUsd: 316.6,
          feesClaimableUsd: 190.4,
        },
      ],
    };
  },

  async claimEarnings(_walletAddress, _tokenAddress) {
    await new Promise((r) => setTimeout(r, 1000));
    return '0x' + Math.random().toString(16).slice(2);
  },
};

export const profileService: IProfileService = mockProfileService;
