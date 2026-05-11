import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as ReduxProvider } from "react-redux";
import {
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
} from "react-router";

import styles from "./App.module.css";
import { CREATE_ROUTE, HOME_ROUTE, TOKEN_ROUTE } from "./routes";
import CreateView from "../components/create/CreateView";
import LandingOverlay from "../components/landing/LandingOverlay";
import AssetTape from "../components/layout/AssetTape";
import DegradedBanner from "../components/layout/DegradedBanner";
import EarningsPanel from "../components/layout/EarningsPanel";
import Header from "../components/layout/Header";
import PrimerModal from "../components/layout/PrimerModal";
import SearchModal from "../components/layout/SearchModal";
import SiteFooter from "../components/layout/SiteFooter";
import ErrorBoundary from "../components/shared/ErrorBoundary";
import { ToastProvider } from "../components/shared/Toast";
import TerminalView from "../components/terminal/TerminalView";
import TokenDetailView from "../components/token/TokenDetailView";
import { hyperEVM } from "../config/chains";
import { wagmiConfig } from "../config/wagmi";
import { store } from "../state/store";
import { cn } from "../utils/format";

const Layout = () => {
  const location = useLocation();
  const isTokenPage = location.pathname.startsWith("/token/");

  return (
    <div className={cn(styles.app, isTokenPage && styles.ambpulse)}>
      <DegradedBanner />
      <Header />
      <AssetTape />
      <Outlet />
      <SiteFooter />
      <SearchModal />
      <EarningsPanel />
      <PrimerModal />
    </div>
  );
};

const router = createBrowserRouter([
  {
    path: HOME_ROUTE,
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <ErrorBoundary>
            <TerminalView />
          </ErrorBoundary>
        ),
      },
      {
        path: TOKEN_ROUTE,
        element: (
          <ErrorBoundary>
            <TokenDetailView />
          </ErrorBoundary>
        ),
      },
      {
        path: CREATE_ROUTE,
        element: (
          <ErrorBoundary>
            <CreateView />
          </ErrorBoundary>
        ),
      },
    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;
if (!privyAppId) {
  throw new Error("VITE_PRIVY_APP_ID is not set — add it to .env.local");
}

// Chrome 140+ shows a "Sites can ask to access other apps and services on this
// device" prompt (a.k.a. Local Network Access / Apps on device) whenever a page
// tries to open a wallet via a native-app deep link (cbwallet://, phantom://,
// metamask://, wc://, …) or invoke a device capability like WebAuthn/passkeys.
// Privy's default modal surfaces every external wallet + Coinbase Smart Wallet
// (passkey) + Solana connectors + the WalletConnect mobile launcher, which
// triggers that dialog even though this app only targets HyperEVM. We keep the
// injected-wallet path (MetaMask, Rabby, and anything else exposed via
// EIP-6963) because that's how most users actually connect, and trim the
// connectors that rely on launching another app:
//   - `walletChainType: "ethereum-only"` drops Phantom/Solflare/Backpack/OKX
//     Solana entries and their `phantom://` style deep links.
//   - `walletConnect.enabled: false` skips the WalletConnect mobile relay,
//     which is the biggest source of the prompt on mobile Chrome.
//   - `coinbaseWallet.preference.options: "eoaOnly"` disables the Coinbase
//     Smart Wallet passkey/WebAuthn flow (keys.coinbase.com), which is the
//     biggest source of the prompt on desktop Chrome.
// MetaMask/Rabby/etc. are detected purely via EIP-6963 window events, so they
// keep working on every platform without any prompt.

const App = () => {
  return (
    <ErrorBoundary>
      <ReduxProvider store={store}>
        <PrivyProvider
          appId={privyAppId}
          config={{
            defaultChain: hyperEVM,
            supportedChains: [hyperEVM],
            appearance: {
              theme: "dark",
              accentColor: "#00ff88",
              walletChainType: "ethereum-only",
            },
            loginMethods: ["wallet"],
            externalWallets: {
              coinbaseWallet: {
                config: { preference: { options: "eoaOnly" } },
              },
              walletConnect: { enabled: false },
            },
          }}
        >
          <QueryClientProvider client={queryClient}>
            <WagmiProvider config={wagmiConfig}>
              <ToastProvider>
                <RouterProvider router={router} />
                <LandingOverlay />
              </ToastProvider>
            </WagmiProvider>
          </QueryClientProvider>
        </PrivyProvider>
      </ReduxProvider>
    </ErrorBoundary>
  );
};

export default App;
