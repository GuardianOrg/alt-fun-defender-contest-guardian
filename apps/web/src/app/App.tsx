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
import { CREATE_ROUTE, HOME_ROUTE, PROFILE_ROUTE, TOKEN_ROUTE } from "./routes";
import CreateView from "../components/create/CreateView";
import AssetTape from "../components/layout/AssetTape";
import DegradedBanner from "../components/layout/DegradedBanner";
import EarningsPanel from "../components/layout/EarningsPanel";
import GeoBlockBanner from "../components/layout/GeoBlockBanner";
import Header from "../components/layout/Header";
import NotFound from "../components/layout/NotFound";
import PrimerModal from "../components/layout/PrimerModal";
import SearchModal from "../components/layout/SearchModal";
import SiteFooter from "../components/layout/SiteFooter";
import ProfileView from "../components/profile/ProfileView";
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
      <GeoBlockBanner />
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
      {
        path: PROFILE_ROUTE,
        element: (
          <ErrorBoundary>
            <ProfileView />
          </ErrorBoundary>
        ),
      },
      {
        path: "*",
        element: <NotFound />,
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

// Keep Privy's wallet list to injected EIP-6963 wallets. Native deep links,
// WalletConnect mobile launchers, and Coinbase Smart Wallet passkeys trigger
// Chrome's local-network/device-access prompt even though this app is HyperEVM-only.

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
              // Match the wallet-only loginMethods explicitly to avoid Privy's
              // auto-correction warning on every page load.
              showWalletLoginFirst: true,
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
              </ToastProvider>
            </WagmiProvider>
          </QueryClientProvider>
        </PrivyProvider>
      </ReduxProvider>
    </ErrorBoundary>
  );
};

export default App;
