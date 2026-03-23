import { useAccount } from "wagmi";

import type { Address } from "viem";

// Set this to any address to simulate being connected as that user
const SIMULATED_ACCOUNT: Address | null = null;

interface BounceAccount {
  address: Address | null;
  isConnected: boolean;
}

const useBounceAccount = (): BounceAccount => {
  const { address, isConnected } = useAccount();

  if (SIMULATED_ACCOUNT) {
    return {
      address: SIMULATED_ACCOUNT,
      isConnected: true,
    };
  }

  return {
    address: address ? (address as Address) : null,
    isConnected: isConnected ?? false,
  };
};

export default useBounceAccount;
