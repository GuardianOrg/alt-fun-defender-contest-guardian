import { useMemo, type FC, type PropsWithChildren } from "react";

import { PrivyProvider } from "@privy-io/react-auth";
import { createConfig, WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "wagmi";
import { mainnet } from "wagmi/chains";

import whiteLogo from "../assets/logo-full-white.svg";
import logo from "../assets/logo-full.svg";
import { hyperEvm } from "../constants/hyperEvm";
import { useTheme } from "../hooks/useTheme";

const queryClient = new QueryClient();

export const PrivyProviderWrapper: FC<PropsWithChildren> = ({ children }) => {
  const rpcUrl = import.meta.env.VITE_RPC_URL;
  const wagmiConfig = useMemo(() => {
    return createConfig({
      chains: [hyperEvm, mainnet],
      transports: {
        [hyperEvm.id]: http(rpcUrl),
        [mainnet.id]: http(),
      },
    });
  }, [rpcUrl]);

  const { theme } = useTheme();
  const logoSrc = theme === "dark" ? whiteLogo : logo;

  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: theme,
          landingHeader: "",
          logo: logoSrc,
          walletList: [
            "rabby_wallet",
            "metamask",
            "wallet_connect_qr",
            "okx_wallet",
            "coinbase_wallet",
          ],
        },
        defaultChain: hyperEvm,
        supportedChains: [hyperEvm, mainnet],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
};
