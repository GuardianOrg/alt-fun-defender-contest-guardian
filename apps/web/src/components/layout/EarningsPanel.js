"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = EarningsPanel;
var react_1 = require("react");
var react_redux_1 = require("react-redux");
var react_router_1 = require("react-router");
var BalancesTab_1 = require("./BalancesTab");
var EarningsPanel_module_css_1 = require("./EarningsPanel.module.css");
var RewardsTab_1 = require("./RewardsTab");
var routes_1 = require("../../app/routes");
var useCreatorEarnings_1 = require("../../hooks/useCreatorEarnings");
var useWallet_1 = require("../../hooks/useWallet");
var uiSlice_1 = require("../../state/uiSlice");
var format_1 = require("../../utils/format");
var ModalOverlay_1 = require("../shared/ModalOverlay");
function EarningsPanel() {
    var open = (0, react_redux_1.useSelector)(uiSlice_1.selectEarningsOpen);
    var dispatch = (0, react_redux_1.useDispatch)();
    var navigate = (0, react_router_1.useNavigate)();
    var _a = (0, useWallet_1.useWallet)(), isConnected = _a.isConnected, shortAddress = _a.shortAddress, connect = _a.connect;
    var _b = (0, useCreatorEarnings_1.useCreatorEarnings)(), earnings = _b.earnings, claiming = _b.claiming, claim = _b.claim;
    var _c = (0, useCreatorEarnings_1.useBalances)(), heldTokens = _c.tokens, totalValue = _c.totalValue;
    var _d = (0, react_1.useState)("balances"), tab = _d[0], setTab = _d[1];
    if (!open)
        return null;
    var setOpen = function (v) { return dispatch((0, uiSlice_1.setEarningsOpen)(v)); };
    var goToToken = function (addr) {
        setOpen(false);
        navigate((0, routes_1.tokenPath)(addr));
    };
    return (<ModalOverlay_1.default onClose={function () { return setOpen(false); }}>
      <div className={EarningsPanel_module_css_1.default.panel}>
        {/* Panel header */}
        <div className={EarningsPanel_module_css_1.default.panelHeader}>
          {isConnected ? (<div className={EarningsPanel_module_css_1.default.avatarWrap}>
              <img src="/avatar.png" alt="" className={EarningsPanel_module_css_1.default.avatar}/>
              <div>
                <div className={EarningsPanel_module_css_1.default.addressText}>{shortAddress}</div>
                <div className={EarningsPanel_module_css_1.default.chainText}>HyperEVM</div>
              </div>
            </div>) : (<div className={EarningsPanel_module_css_1.default.profileLabel}>profile</div>)}
          <button className={EarningsPanel_module_css_1.default.escBtn} onClick={function () { return setOpen(false); }}>
            esc
          </button>
        </div>

        {!isConnected ? (<div className={EarningsPanel_module_css_1.default.notConnected}>
            <div className={EarningsPanel_module_css_1.default.emptyIcon}>&#x1F464;</div>
            <div className={EarningsPanel_module_css_1.default.textCenter}>
              <div className={EarningsPanel_module_css_1.default.emptyTitle}>Connect your wallet</div>
              <div className={EarningsPanel_module_css_1.default.emptyText}>
                View your token balances on the curve and claim creator rewards.
              </div>
            </div>
            <button className={EarningsPanel_module_css_1.default.connectBtn} onClick={connect}>
              Connect Wallet
            </button>
          </div>) : (<>
            {/* Tabs */}
            <div className={EarningsPanel_module_css_1.default.tabBar}>
              {["balances", "rewards"].map(function (t) { return (<button key={t} className={(0, format_1.cn)(EarningsPanel_module_css_1.default.tabButton, tab === t && EarningsPanel_module_css_1.default.tabButtonActive)} onClick={function () { return setTab(t); }}>
                  {t === "balances" ? "Balances" : "Creator Rewards"}
                  {tab === t && <span className={EarningsPanel_module_css_1.default.tabIndicator}/>}
                </button>); })}
            </div>

            <div className={EarningsPanel_module_css_1.default.contentArea}>
              {tab === "balances" ? (<BalancesTab_1.default tokens={heldTokens} totalValue={totalValue} onTokenClick={goToToken} onLaunch={function () {
                    setOpen(false);
                    navigate(routes_1.CREATE_PATH);
                }}/>) : (<RewardsTab_1.default earnings={earnings !== null && earnings !== void 0 ? earnings : undefined} claiming={claiming} claim={claim} onTokenClick={goToToken} onLaunch={function () {
                    setOpen(false);
                    navigate(routes_1.CREATE_PATH);
                }}/>)}
            </div>
          </>)}
      </div>
    </ModalOverlay_1.default>);
}
