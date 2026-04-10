import { useMemo } from "react";

import { LiFiWidget, type WidgetConfig } from "@lifi/widget";

import { useTheme } from "../../../hooks/useTheme";

export const LifiWidget = () => {
  const { theme } = useTheme();

  const widgetConfig = useMemo<WidgetConfig>(
    () => ({
      integrator: "bounce",
      apiKey: import.meta.env.VITE_LIFI_KEY,
      variant: "compact",
      appearance: theme,
      theme: {
        colorSchemes: {
          light: {
            palette: {
              primary: {
                main: "#6753f1",
              },
              secondary: {
                main: "#ece3ff",
              },
              text: {
                primary: "#161616",
                secondary: "#8f8f9c",
              },
              success: {
                main: "#52be60",
              },
              warning: {
                main: "#ffd54f",
              },
              error: {
                main: "#f76960",
              },
              info: {
                main: "#1976d2",
              },
              grey: {
                200: "#e6e7ee",
                300: "#d4d6de",
              },
              background: {
                paper: "#f9f9fb",
              },
            },
          },
          dark: {
            palette: {
              primary: {
                main: "#6753f1",
              },
              secondary: {
                main: "#6753f1",
              },
              background: {
                default: "#242047",
                paper: "#242047",
              },
              grey: {
                800: "#423e62",
              },
            },
          },
        },
        container: {
          borderRadius: "0.8rem",
        },
        typography: {
          fontFamily: "Sora, sans-serif",
        },
        shape: {
          borderRadius: 8,
          borderRadiusSecondary: 8,
        },
      },
      hiddenUI: ["history", "appearance", "language", "walletMenu"],
      // hyperEVM chain ID
      toChain: 999,
      // USDC on hyperEVM
      toToken: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
      // IMPORTANT NOTE: Ensure chain is defined in wagmi.ts
      chains: {
        allow: [
          1, //eth mainnet
          42161, // arbitrum
          999, // hyperEVM
          56, // bsc
          8453, // base
          10, // optimism
          43114, // avalanche
          137, // polygon
          143, // monad
          57073, // ink
          9745, // plasma
          // Chains below require additional integration work
          // 9270000000000000, //sui
          // 1151111081099710, // solana
          // 1337, // hyperliquid
        ],
      },
      walletConfig: {
        forceInternalWalletManagement: true,
      },
    }),
    [theme],
  );

  return <LiFiWidget integrator="bounce" config={widgetConfig} />;
};
