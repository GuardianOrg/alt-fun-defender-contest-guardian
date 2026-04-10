import type { LeveragedTokenData } from "../types/leverageTokenData";

export const BTC2L: LeveragedTokenData = {
  address: "0x1EefbAcFeA06D786Ce012c6fc861bec6C7a828c1",
  targetAsset: "BTC",
  targetLeverage: 2,
  isLong: true,
  exchangeRate: 706254834928708308n,
  baseAssetBalance: 17683160n,
  totalAssets: 400000000n,
  balanceOf: 14159195102727237224n,
  mintPaused: false,
  symbol: "BTC2L",
  isStandbyMode: false,
};

export const ETH3S: LeveragedTokenData = {
  address: "0x2525F0794A927DF477292beE1BC1FD57B8a82614",
  targetAsset: "ETH",
  targetLeverage: 3,
  isLong: false,
  exchangeRate: 1640394000000000000n,
  baseAssetBalance: 11637500n,
  totalAssets: 400000000n,
  balanceOf: 6096096425614821805n,
  mintPaused: false,
  symbol: "ETH3S",
  isStandbyMode: false,
};

export const STANDBY_ETH3S: LeveragedTokenData = {
  address: "0x2525F0794A927DF477292beE1BC1FD57B8a82614",
  targetAsset: "ETH",
  targetLeverage: 3,
  isLong: false,
  exchangeRate: 1195182000000000000n,
  baseAssetBalance: 11637500n,
  totalAssets: 100000n,
  balanceOf: 836692654340510482n,
  mintPaused: false,
  symbol: "ETH3S",
  isStandbyMode: true,
};

export const globalStorageDataMock = {
  airdrop: "0x0000000000000000000000000000000000000000",
  allMintsPaused: false,
  baseAsset: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
  bounce: "0x0000000000000000000000000000000000000000",
  executeRedemptionFee: 2000000n,
  factory: "0xeD8bCDe433EB7c4B69DB1235483bf0Edb726Fc1B",
  feeHandler: "0x0000000000000000000000000000000000000000",
  hyperliquidHandler: "0x0f1365392EA9Df901dEb94d100679E7440E499bc",
  ltImplementation: "0x126e039f97Dd34fa64E685Ba4b37ca97b1a03DcB",
  minLockAmount: 10000000000000000000n,
  minTransactionSize: 10000000n,
  owner: "0xeC92e5C8f3319bbC09E4Dc86bFAB5c15e54e0C48",
  redemptionFee: 3000000000000000n,
  refereeRebate: 100000000000000000n,
  referrals: "0xfD3A6323878Fc991447CcDd4c644ab419afC6f76",
  referrerRebate: 200000000000000000n,
  streamingFee: 20000000000000000n,
  treasury: "0x7Fe37fC2F987Eb981A0Fc63cf1EaBF04463550D4",
  treasuryFeeShare: 50000000000000000n,
  vesting: "0x0000000000000000000000000000000000000000",
};
