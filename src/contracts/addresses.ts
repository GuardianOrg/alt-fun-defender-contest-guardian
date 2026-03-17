/**
 * Contract addresses on HyperEVM.
 * All zeros = not yet deployed. Replace with real addresses when contracts land.
 */

export const ADDRESSES = {
  /** Routes buy/sell through LT mint/redeem + bonding curve atomically */
  txRouter: '0x0000000000000000000000000000000000000000' as `0x${string}`,

  /** Bounce referral module — router calls go through this for fee attribution */
  referralModule: '0x0000000000000000000000000000000000000000' as `0x${string}`,

  /** Factory that deploys new bonding curve + memecoin pairs */
  curveFactory: '0x0000000000000000000000000000000000000000' as `0x${string}`,

  /** USDC on HyperEVM — the only token users interact with */
  usdc: '0x0000000000000000000000000000000000000000' as `0x${string}`,
} as const;

export const USDC_DECIMALS = 6;
