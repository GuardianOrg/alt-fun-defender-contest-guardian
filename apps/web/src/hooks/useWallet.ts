import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

import { shortenAddress } from "../utils/format";

export function useWallet() {
  const { address, isConnected: wagmiConnected } = useAccount();
  const { login, ready, authenticated } = usePrivy();
  const { wallets } = useWallets();

  const isConnected = wagmiConnected || (ready && authenticated && wallets.length > 0);
  const activeAddress = address ?? (wallets[0]?.address as `0x${string}` | undefined);

  const connectWallet = () => {
    login();
  };

  return {
    address: activeAddress,
    shortAddress: activeAddress ? shortenAddress(activeAddress) : undefined,
    isConnected,
    connect: connectWallet,
  };
}
