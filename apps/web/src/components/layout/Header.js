"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Header;
var react_1 = require("react");
var react_redux_1 = require("react-redux");
var react_router_1 = require("react-router");
var Header_module_css_1 = require("./Header.module.css");
var routes_1 = require("../../app/routes");
var useWallet_1 = require("../../hooks/useWallet");
var uiSlice_1 = require("../../state/uiSlice");
var format_1 = require("../../utils/format");
var TABS = [
    { label: "MARKETS", path: "/" },
    { label: "PROFILE", action: "earnings" },
];
function Header() {
    var navigate = (0, react_router_1.useNavigate)();
    var location = (0, react_router_1.useLocation)();
    var dispatch = (0, react_redux_1.useDispatch)();
    var _a = (0, useWallet_1.useWallet)(), isConnected = _a.isConnected, shortAddress = _a.shortAddress, connect = _a.connect;
    var _b = (0, react_1.useState)("--:--:-- UTC"), clock = _b[0], setClock = _b[1];
    (0, react_1.useEffect)(function () {
        var tick = function () {
            var n = new Date();
            setClock("".concat(String(n.getUTCHours()).padStart(2, "0"), ":").concat(String(n.getUTCMinutes()).padStart(2, "0"), ":").concat(String(n.getUTCSeconds()).padStart(2, "0"), " UTC"));
        };
        tick();
        var id = setInterval(tick, 1000);
        return function () { return clearInterval(id); };
    }, []);
    var isCreate = location.pathname === routes_1.CREATE_PATH;
    return (<header className={Header_module_css_1.default.header}>
      <div className={Header_module_css_1.default.logo} onClick={function () { return navigate("/"); }}>
        <span className={Header_module_css_1.default.logoMint}>LAUNCH</span>
        <span className={Header_module_css_1.default.logoTxt}>PAD</span>
      </div>

      <div className={Header_module_css_1.default.tagline}>
        <span className={Header_module_css_1.default.taglineMint}>leverage</span>
        <span className={Header_module_css_1.default.taglineSep}>&times;</span>
        <span className={Header_module_css_1.default.taglineTxt}>memes</span>
      </div>

      <nav className={Header_module_css_1.default.nav}>
        {TABS.map(function (tab) {
            var hasPath = "path" in tab;
            var isActive = hasPath && tab.path === "/" && location.pathname === "/";
            return (<button key={tab.label} className={(0, format_1.cn)(Header_module_css_1.default.navButton, isActive && Header_module_css_1.default.navButtonActive)} onClick={function () {
                    if ("action" in tab && tab.action === "earnings") {
                        dispatch((0, uiSlice_1.setEarningsOpen)(true));
                    }
                    else if (hasPath && tab.path !== "#") {
                        navigate(tab.path);
                    }
                }}>
              {tab.label}
              {isActive && <span className={Header_module_css_1.default.activeIndicator}/>}
            </button>);
        })}
      </nav>

      {!isCreate && (<div className={Header_module_css_1.default.searchTrigger} onClick={function () { return dispatch((0, uiSlice_1.setSearchOpen)(true)); }}>
          <span className={Header_module_css_1.default.searchIcon}>&#x2315;</span>
          <span className={Header_module_css_1.default.searchText}>Search tokens&hellip;</span>
          <span className={Header_module_css_1.default.searchKbd}>⌘K</span>
        </div>)}

      <div className={Header_module_css_1.default.rightSide}>
        <span className={Header_module_css_1.default.clock}>{clock}</span>
        {isConnected ? (<span className={Header_module_css_1.default.walletAddress} onClick={function () { return dispatch((0, uiSlice_1.setEarningsOpen)(true)); }}>
            {shortAddress}
          </span>) : (<button className={Header_module_css_1.default.connectButton} onClick={connect}>
            Connect Wallet
          </button>)}
        {isCreate ? (<button className={Header_module_css_1.default.creatingBtn}>
            &#x26A1; creating token
          </button>) : (<button className={Header_module_css_1.default.launchBtn} onClick={function () { return navigate(routes_1.CREATE_PATH); }}>
            &#x26A1; launch a levered token
          </button>)}
      </div>
    </header>);
}
