import type { FC, PropsWithChildren } from "react";

import {
  darkTheme,
  lightTheme,
  RainbowKitProvider,
  type Theme,
} from "@rainbow-me/rainbowkit";
import merge from "lodash.merge";
import { WagmiProvider } from "wagmi";

import { hyperEvm, rainbowKitConfig } from "../app/wagmi";
import { useTheme } from "../hooks/useTheme";

export const WalletProvider: FC<PropsWithChildren> = ({ children }) => {
  const { theme } = useTheme();

  const isDark = theme === "dark";

  const bounceTheme = merge(isDark ? darkTheme() : lightTheme(), {
    colors: {
      accentColor: "var(--primary-500)",
    },
  } as Theme);

  return (
    <WagmiProvider config={rainbowKitConfig}>
      <RainbowKitProvider
        theme={bounceTheme}
        initialChain={hyperEvm}
        modalSize="compact"
      >
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
};
