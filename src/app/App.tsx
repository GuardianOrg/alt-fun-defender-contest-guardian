import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as ReduxProvider } from "react-redux";
import {
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
} from "react-router";
import { WagmiProvider } from "wagmi";

import styles from "./App.module.css";
import { CREATE_ROUTE, HOME_ROUTE, TOKEN_ROUTE } from "./routes";
import CreateView from "../components/create/CreateView";
import AssetTape from "../components/layout/AssetTape";
import EarningsPanel from "../components/layout/EarningsPanel";
import Header from "../components/layout/Header";
import PasswordGate from "../components/layout/PasswordGate";
import SearchModal from "../components/layout/SearchModal";
import ErrorBoundary from "../components/shared/ErrorBoundary";
import LeverageBanner from "../components/terminal/LeverageBanner";
import TerminalView from "../components/terminal/TerminalView";
import TokenDetailView from "../components/token/TokenDetailView";
import { wagmiConfig } from "../config/wagmi";
import { store } from "../state/store";
import { cn } from "../utils/format";

const Layout = () => {
  const location = useLocation();
  const isTokenPage = location.pathname.startsWith("/token/");

  return (
    <PasswordGate>
      <div className={cn(styles.app, isTokenPage && styles.ambpulse)}>
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
      { index: true, element: <TerminalView /> },
      { path: TOKEN_ROUTE, element: <TokenDetailView /> },
      { path: CREATE_ROUTE, element: <CreateView /> },
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

const App = () => {
  return (
    <ErrorBoundary>
      <ReduxProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <WagmiProvider config={wagmiConfig}>
            <RouterProvider router={router} />
          </WagmiProvider>
        </QueryClientProvider>
      </ReduxProvider>
    </ErrorBoundary>
  );
};

export default App;
