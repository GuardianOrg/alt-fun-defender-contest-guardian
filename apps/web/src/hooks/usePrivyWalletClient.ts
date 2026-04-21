import { useEffect, useState } from "react";

import { useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom } from "viem";
import { useWalletClient as useWagmiWalletClient, useSwitchChain } from "wagmi";

import { hyperEVM } from "../config/chains";

import type { Account, Chain, Transport, WalletClient } from "viem";

type ConnectedWalletClient = WalletClient<Transport, Chain, Account>;

/**
 * Returns a viem WalletClient on HyperEVM from either wagmi or
 * directly from the Privy embedded wallet provider as a fallback.
 * Automatically switches the wallet to HyperEVM if needed.
 */
export function usePrivyWalletClient(): ConnectedWalletClient | undefined {
  const { data: wagmiClient } = useWagmiWalletClient();
  const { switchChain } = useSwitchChain();
  const { wallets } = useWallets();
  const [privyClient, setPrivyClient] = useState<ConnectedWalletClient | undefined>();

  const privyWallet = wallets[0];
  const privyAddress = privyWallet?.address;

  const wagmiOnCorrectChain = wagmiClient?.chain?.id === hyperEVM.id;

  // If wagmi has a client but it's on the wrong chain, switch it
  useEffect(() => {
    if (wagmiClient && !wagmiOnCorrectChain) {
      switchChain({ chainId: hyperEVM.id });
    }
  }, [wagmiClient, wagmiOnCorrectChain, switchChain]);

  // Privy fallback: build a wallet client directly from the Privy provider
  useEffect(() => {
    if (wagmiOnCorrectChain || !privyWallet) {
      setPrivyClient(undefined);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await privyWallet.switchChain(hyperEVM.id);
        const provider = await privyWallet.getEthereumProvider();
        if (cancelled) return;
        const client = createWalletClient({
          account: privyAddress as `0x${string}`,
          chain: hyperEVM,
          transport: custom(provider),
        });
        setPrivyClient(client as ConnectedWalletClient);
      } catch {
        if (!cancelled) setPrivyClient(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wagmiOnCorrectChain, privyWallet, privyAddress]);

  if (wagmiOnCorrectChain) {
    return wagmiClient as ConnectedWalletClient;
  }
  return privyClient;
}
