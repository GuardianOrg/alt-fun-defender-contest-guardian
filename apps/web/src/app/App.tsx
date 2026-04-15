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
import AssetTape from "../components/layout/AssetTape";
import DegradedBanner from "../components/layout/DegradedBanner";
import EarningsPanel from "../components/layout/EarningsPanel";
import Header from "../components/layout/Header";
import PasswordGate from "../components/layout/PasswordGate";
import SearchModal from "../components/layout/SearchModal";
import ErrorBoundary from "../components/shared/ErrorBoundary";
import LeverageBanner from "../components/terminal/LeverageBanner";
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
    <PasswordGate>
      <div className={cn(styles.app, isTokenPage && styles.ambpulse)}>
        <DegradedBanner />
        <LeverageBanner />
        <Header />
        <AssetTape />
        <Outlet />
        <SearchModal />
        <EarningsPanel />
      </div>
    </PasswordGate>
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
            },
            embeddedWallets: {
              ethereum: {
                createOnLogin: "users-without-wallets",
              },
            },
          }}
        >
          <QueryClientProvider client={queryClient}>
            <WagmiProvider config={wagmiConfig}>
              <RouterProvider router={router} />
            </WagmiProvider>
          </QueryClientProvider>
        </PrivyProvider>
      </ReduxProvider>
    </ErrorBoundary>
  );
};

export default App;
