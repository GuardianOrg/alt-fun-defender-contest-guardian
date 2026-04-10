import type { Address } from "viem";

// WARNING: this must match the message in the API, careful when changing
export const SIGNATURE_MESSAGE =
  "I agree to the Bounce Terms of Service https://bounce.tech/terms-of-service and Bounce Privacy Policy https://bounce.tech/privacy-policy. I acknowledge that Bounce integrates with third-party applications, which may come with risks";

export const EARLIEST_BLOCK = 16730184n;

export const blockExplorerAddress = (address: Address): string => {
  return `https://hyperevmscan.io/address/${address}`;
};

export const blockExplorerTx = (txHash: string): string => {
  return `https://hyperevmscan.io/tx/${txHash}`;
};

export const REFRESH_INTERVAL = 2000;
