"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var react_auth_1 = require("@privy-io/react-auth");
var wagmi_1 = require("@privy-io/wagmi");
var react_query_1 = require("@tanstack/react-query");
var react_redux_1 = require("react-redux");
var react_router_1 = require("react-router");
var wagmi_2 = require("wagmi");
var App_module_css_1 = require("./App.module.css");
var routes_1 = require("./routes");
var CreateView_1 = require("../components/create/CreateView");
var AssetTape_1 = require("../components/layout/AssetTape");
var DegradedBanner_1 = require("../components/layout/DegradedBanner");
var EarningsPanel_1 = require("../components/layout/EarningsPanel");
var Header_1 = require("../components/layout/Header");
var PasswordGate_1 = require("../components/layout/PasswordGate");
var SearchModal_1 = require("../components/layout/SearchModal");
var ErrorBoundary_1 = require("../components/shared/ErrorBoundary");
var LeverageBanner_1 = require("../components/terminal/LeverageBanner");
var TerminalView_1 = require("../components/terminal/TerminalView");
var TokenDetailView_1 = require("../components/token/TokenDetailView");
var chains_1 = require("../config/chains");
var wagmi_3 = require("../config/wagmi");
var store_1 = require("../state/store");
var format_1 = require("../utils/format");
var Layout = function () {
    var location = (0, react_router_1.useLocation)();
    var isTokenPage = location.pathname.startsWith("/token/");
    return (<PasswordGate_1.default>
      <div className={(0, format_1.cn)(App_module_css_1.default.app, isTokenPage && App_module_css_1.default.ambpulse)}>
        <DegradedBanner_1.default />
        <LeverageBanner_1.default />
        <Header_1.default />
        <AssetTape_1.default />
        <react_router_1.Outlet />
        <SearchModal_1.default />
        <EarningsPanel_1.default />
      </div>
    </PasswordGate_1.default>);
};
var router = (0, react_router_1.createBrowserRouter)([
    {
        path: routes_1.HOME_ROUTE,
        element: <Layout />,
        children: [
            {
                index: true,
                element: (<ErrorBoundary_1.default>
            <TerminalView_1.default />
          </ErrorBoundary_1.default>),
            },
            {
                path: routes_1.TOKEN_ROUTE,
                element: (<ErrorBoundary_1.default>
            <TokenDetailView_1.default />
          </ErrorBoundary_1.default>),
            },
            {
                path: routes_1.CREATE_ROUTE,
                element: (<ErrorBoundary_1.default>
            <CreateView_1.default />
          </ErrorBoundary_1.default>),
            },
        ],
    },
]);
var queryClient = new react_query_1.QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 10000,
            refetchOnWindowFocus: false,
        },
    },
});
var privyAppId = import.meta.env.VITE_PRIVY_APP_ID;
if (!privyAppId) {
    throw new Error("VITE_PRIVY_APP_ID is not set — add it to .env.local");
}
var App = function () {
    return (<ErrorBoundary_1.default>
      <react_redux_1.Provider store={store_1.store}>
        <react_auth_1.PrivyProvider appId={privyAppId} config={{
            defaultChain: chains_1.hyperEVM,
            supportedChains: [chains_1.hyperEVM],
            appearance: {
                theme: "dark",
                accentColor: "#00ff88",
            },
            embeddedWallets: {
                ethereum: {
                    createOnLogin: "users-without-wallets",
                },
            },
        }}>
          <react_query_1.QueryClientProvider client={queryClient}>
            <wagmi_2.WagmiProvider config={wagmi_3.wagmiConfig}>
              <wagmi_1.WagmiProvider config={wagmi_3.wagmiConfig}>
                <react_router_1.RouterProvider router={router}/>
              </wagmi_1.WagmiProvider>
            </wagmi_2.WagmiProvider>
          </react_query_1.QueryClientProvider>
        </react_auth_1.PrivyProvider>
      </react_redux_1.Provider>
    </ErrorBoundary_1.default>);
};
exports.default = App;
