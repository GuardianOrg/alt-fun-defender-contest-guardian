import type { Trade, Comment, Holder } from '../types';

const FEED_TOKEN_NAMES = [
  'MOONBOUND',
  'HOUSE',
  'CRASHOUT',
  'WAVEBEAR',
  'HYPERVADER',
  'DOOMER',
  'BTCMAXI',
];
const WALLETS = [
  '0x9c…11',
  '0x4f…3a',
  '0x7b…cc',
  '0x2e…f0',
  '0x8a…12',
  '0x1d…c4',
  '0x5f…88',
  '0x3c…f2',
];

let tradeIdCounter = 0;
let feedSeconds = 4;
let tokenTradeSeconds = 4;

function randomWallet(): string {
  return WALLETS[Math.floor(Math.random() * WALLETS.length)];
}

function randomHex(): string {
  return Math.random().toString(16).slice(2, 4);
}

export function generateFeedTrade(): Trade {
  const token = FEED_TOKEN_NAMES[Math.floor(Math.random() * FEED_TOKEN_NAMES.length)];
  const side: 'BUY' | 'SELL' = Math.random() > 0.28 ? 'BUY' : 'SELL';
  const amt = Math.floor(Math.random() * 60 + 1) * 50;
  const wallet = `0x${randomHex()}…${randomHex()}`;
  const m = String(Math.floor(feedSeconds / 60)).padStart(2, '0');
  const s = String(feedSeconds % 60).padStart(2, '0');
  feedSeconds += Math.floor(Math.random() * 4 + 1);
  tradeIdCounter++;

  return {
    id: `feed-${tradeIdCounter}`,
    side,
    amountUsd: amt,
    tokensAmount: `${((amt / 0.000188) / 1e6).toFixed(1)}M`,
    walletAddress: wallet,
    timestamp: `${m}:${s}`,
    tokenAddress: '',
    tokenName: token,
  };
}

export function generateTokenTrade(): Trade {
  const side: 'BUY' | 'SELL' = Math.random() > 0.28 ? 'BUY' : 'SELL';
  const amt = Math.floor(Math.random() * 60 + 1) * 50;
  const wallet = randomWallet();
  const m = String(Math.floor(tokenTradeSeconds / 60)).padStart(2, '0');
  const s = String(tokenTradeSeconds % 60).padStart(2, '0');
  tokenTradeSeconds += Math.floor(Math.random() * 4 + 1);
  tradeIdCounter++;

  return {
    id: `token-${tradeIdCounter}`,
    side,
    amountUsd: amt,
    tokensAmount: `${((amt / 0.000188) / 1e6).toFixed(1)}M`,
    walletAddress: wallet,
    timestamp: `${m}:${s}`,
    tokenAddress: '0x3f4a8b2c9d1e5f7a100000000000babe',
    tokenName: 'MOONBOUND',
  };
}

export const INITIAL_TOKEN_TRADES: Trade[] = [
  { id: 'init-1', side: 'BUY', amountUsd: 5000, tokensAmount: '26.6M', walletAddress: '0x1d…c4', timestamp: '00:04', tokenAddress: '', tokenName: 'MOONBOUND' },
  { id: 'init-2', side: 'BUY', amountUsd: 2100, tokensAmount: '11.2M', walletAddress: '0x9c…11', timestamp: '00:17', tokenAddress: '', tokenName: 'MOONBOUND' },
  { id: 'init-3', side: 'SELL', amountUsd: 320, tokensAmount: '1.7M', walletAddress: '0x7a…fe', timestamp: '00:31', tokenAddress: '', tokenName: 'MOONBOUND' },
  { id: 'init-4', side: 'BUY', amountUsd: 840, tokensAmount: '4.5M', walletAddress: '0x4f…3a', timestamp: '00:48', tokenAddress: '', tokenName: 'MOONBOUND' },
  { id: 'init-5', side: 'BUY', amountUsd: 1200, tokensAmount: '6.4M', walletAddress: '0x5f…88', timestamp: '01:02', tokenAddress: '', tokenName: 'MOONBOUND' },
  { id: 'init-6', side: 'SELL', amountUsd: 190, tokensAmount: '1.0M', walletAddress: '0x8e…21', timestamp: '01:19', tokenAddress: '', tokenName: 'MOONBOUND' },
];

export const MOCK_COMMENTS: Comment[] = [
  { id: 'c1', emoji: '🐸', address: '0x4f…3a', timeAgo: '2m ago', text: 'HYPE pumping and this thing flying, lfg 🚀' },
  { id: 'c2', emoji: '💀', address: '0x9c…11', timeAgo: '8m ago', text: 'graduating before 5h mark, this is the one' },
  { id: 'c3', emoji: '🦁', address: '0x2b…88', timeAgo: '14m ago', text: '3x leverage on HYPE during a green day = cheat code' },
];

export const MOCK_HOLDERS: Holder[] = [
  { rank: 1, address: '0x9c…11', tokens: '124.2M', percentSupply: 12.4, isCreator: true },
  { rank: 2, address: '0x4f…3a', tokens: '98.1M', percentSupply: 9.8, isCreator: false },
  { rank: 3, address: '0x7b…cc', tokens: '71.4M', percentSupply: 7.1, isCreator: false },
  { rank: 4, address: '0x2e…f0', tokens: '55.0M', percentSupply: 5.5, isCreator: false },
];
