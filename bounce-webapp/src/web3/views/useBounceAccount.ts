import { usePrivy, useWallets } from "@privy-io/react-auth";

import type { Address } from "viem";

// Set this to any address to simulate being connected as that user
const SIMULATED_ACCOUNT: Address | null = null;

interface BounceAccount {
  address: Address | null;
  isConnected: boolean;
}

const useBounceAccount = (): BounceAccount => {
  const { ready, authenticated } = usePrivy();
  const { wallets = [] } = useWallets();
  const hasWallet = wallets.length > 0;
  const address = wallets[0]?.address || undefined;
  const isConnected = ready && authenticated && hasWallet && !!address;

  if (SIMULATED_ACCOUNT) {
    return {
      address: SIMULATED_ACCOUNT,
      isConnected: true,
    };
  }

  return {
    address: isConnected ? (address as Address) : null,
    isConnected: isConnected,
  };
};

export default useBounceAccount;
