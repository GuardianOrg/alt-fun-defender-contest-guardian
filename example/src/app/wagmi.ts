import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";
import {
  mainnet,
  arbitrum,
  bsc,
  base,
  optimism,
  avalanche,
  polygon,
  monad,
  ink,
  plasma,
} from "viem/chains";
import { createConfig, http } from "wagmi";

export const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "HyperEVMScan",
      url: "https://hyperevmscan.io/",
    },
  },
});

const WALLETCONNECT_PROJECT_ID = "56848fe118580f51286d1e5fb20a1b14";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        rabbyWallet,
        metaMaskWallet,
        rainbowWallet,
        walletConnectWallet,
        coinbaseWallet,
      ],
    },
  ],
  {
    appName: "Bounce Tech",
    projectId: WALLETCONNECT_PROJECT_ID,
  },
);

export const rainbowKitConfig = createConfig({
  chains: [
    hyperEvm,
    mainnet,
    arbitrum,
    bsc,
    base,
    optimism,
    avalanche,
    polygon,
    monad,
    ink,
    plasma,
  ],
  connectors,
  transports: {
    [hyperEvm.id]: http(),
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [bsc.id]: http(),
    [base.id]: http(),
    [optimism.id]: http(),
    [avalanche.id]: http(),
    [polygon.id]: http(),
    [monad.id]: http(),
    [ink.id]: http(),
    [plasma.id]: http(),
  },
  ssr: false,
  multiInjectedProviderDiscovery: false,
});
