import { HelmetProvider } from "react-helmet-async";
import { Provider as ReduxProvider } from "react-redux";
import { Outlet, RouterProvider, createBrowserRouter } from "react-router";
import { PersistGate } from "redux-persist/integration/react";

import {
  AUDITS_ROUTE,
  BLOG_ROUTE,
  HOME_ROUTE,
  LIQUIDATION_SCORE_ROUTE,
  LOCK_ROUTE,
  MINT_ROUTE,
  PORTFOLIO_ROUTE,
  PRIVACY_POLICY_ROUTE,
  REGISTER_ROUTE,
  REWARDS_ROUTE,
  STAKE_ROUTE,
  TERMS_OF_SERVICE_ROUTE,
  VESTING_ROUTE,
} from "./app/routes";
import styles from "./App.module.css";
import asciiArt from "./assets/asciiArt";
import AnnouncementBar from "./components/Global/AnnouncementBar/AnnouncementBar";
import Footer from "./components/Global/Footer/Footer";
import Header from "./components/Global/Header/Header";
import { LifiModal } from "./components/Global/LifiWidget/LifiModal";
import Toast from "./components/Global/Toast/Toast";
import { useFeatureFlags } from "./config/featureFlags";
import { ThemeProvider } from "./contexts/ThemeContext";
import ErrorHandler from "./handlers/ErrorHandler/ErrorHandler";
import HasRegisteredHandler from "./handlers/HasRegisteredHandler";
import HyperEvmChainHandler from "./handlers/HyperEvmChainHandler";
import InviteCodeHandler from "./handlers/InviteCodeHandler";
import ReferralHandler from "./handlers/ReferralHandler";
import ScrollHandler from "./handlers/ScrollHandler";
import SignatureHandler from "./handlers/SignatureHandler";
import AuditsPage from "./pages/AuditsPage/AuditsPage";
import BetaRegisterPage from "./pages/BetaRegisterPage/BetaRegisterPage";
import BlogDetailPage from "./pages/BlogDetailPage/BlogDetailPage";
import BlogPage from "./pages/BlogPage/BlogPage";
import ErrorPage from "./pages/ErrorPage/ErrorPage";
import LandingPage from "./pages/LandingPage/LandingPage";
import LiquidationPointsPage from "./pages/LiquidationPoints/LiquidationPointsPage";
import LockPage from "./pages/LockPage";
import MintPage from "./pages/MintPage/MintPage";
import NotFoundPage from "./pages/NotFoundPage/NotFoundPage";
import PortfolioPage from "./pages/PortfolioPage/PortfolioPage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage/PrivacyPolicyPage";
import RewardsPage from "./pages/RewardsPage";
import StakePage from "./pages/StakePage";
import TermsOfServicePage from "./pages/TermsOfServicePage/TermsOfServicePage";
import VestingPage from "./pages/VestingPage/VestingPage";
import { PrivyProviderWrapper } from "./providers/PrivyProvider";
import { WatchTradesByTxHash } from "./providers/WatchTradesByTxHash";
import { store, persistor } from "./state/store";

import "./styles/global.css";

console.log(asciiArt);
console.info(
  "%cWelcome to Bounce Tech! Bounce is always hiring for great devs. Email chase@bounce.tech",
  "background: #222; color: #d4bdff; font-size: 16px",
);

const Layout = () => {
  return (
    <div className={styles.app}>
      <AnnouncementBar />
      <Header />
      <Outlet />
      <Toast />
      <Footer />
      <LifiModal />
      <HyperEvmChainHandler />
      <ScrollHandler />
      <SignatureHandler />
      <InviteCodeHandler />
      <HasRegisteredHandler />
      <ErrorHandler />
      <ReferralHandler />
      <WatchTradesByTxHash />
    </div>
  );
};

const useAppRoutes = ({
  registerRoute,
  liquidationScoreRoute,
  vestingRoute,
  mintRoute,
  lockRoute,
  stakeRoute,
  portfolioRoute,
  rewardsRoute,
}: {
  registerRoute: boolean;
  liquidationScoreRoute: boolean;
  vestingRoute: boolean;
  mintRoute: boolean;
  lockRoute: boolean;
  stakeRoute: boolean;
  portfolioRoute: boolean;
  rewardsRoute: boolean;
}) => {
  const baseRoutes = [
    { index: true, element: <LandingPage /> },
    { path: BLOG_ROUTE, element: <BlogPage /> },
    { path: `${BLOG_ROUTE}/:slug`, element: <BlogDetailPage /> },
    { path: TERMS_OF_SERVICE_ROUTE, element: <TermsOfServicePage /> },
    { path: PRIVACY_POLICY_ROUTE, element: <PrivacyPolicyPage /> },
    { path: AUDITS_ROUTE, element: <AuditsPage /> },
  ];

  const conditionalRoutes = [
    {
      path: REGISTER_ROUTE,
      element: <BetaRegisterPage />,
      enabled: registerRoute,
    },
    {
      path: LIQUIDATION_SCORE_ROUTE,
      element: <LiquidationPointsPage />,
      enabled: liquidationScoreRoute,
    },
    { path: VESTING_ROUTE, element: <VestingPage />, enabled: vestingRoute },
    {
      path: MINT_ROUTE,
      element: <MintPage />,
      enabled: mintRoute,
    },
    { path: LOCK_ROUTE, element: <LockPage />, enabled: lockRoute },
    { path: STAKE_ROUTE, element: <StakePage />, enabled: stakeRoute },
    {
      path: PORTFOLIO_ROUTE,
      element: <PortfolioPage />,
      enabled: portfolioRoute,
    },
    { path: REWARDS_ROUTE, element: <RewardsPage />, enabled: rewardsRoute },
  ];

  const childrenRoutes = [
    ...baseRoutes,
    ...conditionalRoutes.filter((route) => route.enabled),
  ];

  return [
    {
      path: HOME_ROUTE,
      element: <Layout />,
      errorElement: <ErrorPage />,
      children: childrenRoutes,
    },
    { path: "*", element: <NotFoundPage /> },
  ];
};

const AppRouter = () => {
  const {
    registerRoute,
    liquidationScoreRoute,
    vestingRoute,
    mintRoute,
    lockRoute,
    stakeRoute,
    portfolioRoute,
    rewardsRoute,
  } = useFeatureFlags();
  const routes = useAppRoutes({
    registerRoute,
    liquidationScoreRoute,
    vestingRoute,
    mintRoute,
    lockRoute,
    stakeRoute,
    portfolioRoute,
    rewardsRoute,
  });
  const router = createBrowserRouter(routes);

  return <RouterProvider router={router} />;
};

// Some providers need to query data from Redux, so this is a second wrapper with Redux
const AppWithRedux = () => {
  return (
    <PrivyProviderWrapper>
      <AppRouter />
    </PrivyProviderWrapper>
  );
};

const App = () => {
  return (
    <HelmetProvider>
      <ThemeProvider>
        <ReduxProvider store={store}>
          <PersistGate loading={null} persistor={persistor}>
            <AppWithRedux />
          </PersistGate>
        </ReduxProvider>
      </ThemeProvider>
    </HelmetProvider>
  );
};

export default App;
