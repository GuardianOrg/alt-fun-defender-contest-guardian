import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useDisconnect } from "wagmi";

import { shortenAddress } from "../utils/format";

import type { Address } from "viem";

interface WalletState {
  address: Address | undefined;
  shortAddress: string | undefined;
  isConnected: boolean;
  /** True once Privy + wagmi have hydrated. UI can disable buttons until then. */
  ready: boolean;
  /**
   * Smart connect: opens Privy login when there's no session, or re-attaches
   * a wallet when the session exists but the EIP-1193 provider has dropped
   * (e.g. user hit "Disconnect" inside Rabby/MetaMask). Calling Privy's
   * `login()` while already authenticated throws "already logged in; use a
   * link helper" — `connectWallet()` is the supported escape hatch.
   */
  connect: () => void;
  /** Tear down wagmi + Privy session + cached query data in one shot. */
  disconnect: () => Promise<void>;
}

export function useWallet(): WalletState {
  const { ready, authenticated, login, logout, connectWallet } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const queryClient = useQueryClient();

  const wallet = wallets[0];
  const rawAddress = wallet?.address as Address | undefined;
  const isConnected =
    ready && walletsReady && authenticated && !!rawAddress;
  const address = isConnected ? rawAddress : undefined;

  const connect = (): void => {
    if (!ready) return;
    if (!authenticated) {
      login();
      return;
    }
    // Session exists but no EIP-1193 wallet in `useWallets()` yet — re-attach
    // via `connectWallet()`. Calling `login()` here throws.
    if (!rawAddress) {
      connectWallet();
      return;
    }
  };

  const disconnect = async (): Promise<void> => {
    try {
      wagmiDisconnect();
      queryClient.clear();
      if (authenticated) {
        await logout();
      }
    } catch (err) {
      // Logout occasionally throws when Privy state is already torn down
      // (e.g. user wiped storage). Surfacing this would block the UI from
      // resetting, so swallow and let the next render pick up the new state.
      console.warn("Wallet disconnect failed:", err);
    }
  };

  return {
    address,
    shortAddress: address ? shortenAddress(address) : undefined,
    isConnected,
    ready: ready && walletsReady,
    connect,
    disconnect,
  };
}
