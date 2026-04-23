import { CONTRACT_ADDRESSES, USDC_ADDRESS } from "@launchpad/shared";

export const ADDRESSES = {
  bonding: CONTRACT_ADDRESSES.bonding as `0x${string}`,
  factory: CONTRACT_ADDRESSES.factory as `0x${string}`,
  router: CONTRACT_ADDRESSES.router as `0x${string}`,
  launchpadRouter: CONTRACT_ADDRESSES.launchpadRouter as `0x${string}`,
  lpLock: CONTRACT_ADDRESSES.lpLock as `0x${string}`,
  feeVault: CONTRACT_ADDRESSES.feeVault as `0x${string}`,
  usdc: USDC_ADDRESS as `0x${string}`,
} as const;

export const USDC_DECIMALS = 6;
