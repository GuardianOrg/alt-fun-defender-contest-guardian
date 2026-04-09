import { USDC_ADDRESS } from "@launchpad/shared";

/**
 * Contract addresses on HyperEVM.
 * All zeros = not yet deployed. Replace with real addresses when contracts land.
 */

export const ADDRESSES = {
  /** Routes buy/sell through LT mint/redeem + bonding curve atomically */
  txRouter: "0x0000000000000000000000000000000000000000" as `0x${string}`,

  /** Referral module — router calls go through this for fee attribution */
  referralModule: "0x0000000000000000000000000000000000000000" as `0x${string}`,

  /** Factory that deploys new bonding curve + memecoin pairs */
  curveFactory: "0x0000000000000000000000000000000000000000" as `0x${string}`,

  usdc: USDC_ADDRESS,
} as const;

export const USDC_DECIMALS = 6;
