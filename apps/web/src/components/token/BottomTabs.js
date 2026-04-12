"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = BottomTabs;
var react_1 = require("react");
var BottomTabs_module_css_1 = require("./BottomTabs.module.css");
var CommentsTab_1 = require("./CommentsTab");
var HoldersTab_1 = require("./HoldersTab");
var TradesTab_1 = require("./TradesTab");
var tradeService_1 = require("../../services/tradeService");
var format_1 = require("../../utils/format");
var ErrorBoundary_1 = require("../shared/ErrorBoundary");
function BottomTabs(_a) {
    var token = _a.token;
    var _b = (0, react_1.useState)("trades"), activeTab = _b[0], setActiveTab = _b[1];
    var _c = (0, react_1.useState)([]), holders = _c[0], setHolders = _c[1];
    (0, react_1.useEffect)(function () {
        tradeService_1.tradeService.getHolders(token.address).then(setHolders);
    }, [token.address]);
    return (<>
      <div className={BottomTabs_module_css_1.default.tabBar}>
        {["trades", "comments", "holders"].map(function (tab) { return (<button key={tab} className={(0, format_1.cn)(BottomTabs_module_css_1.default.tabBtn, activeTab === tab && BottomTabs_module_css_1.default.tabBtnActive)} onClick={function () { return setActiveTab(tab); }}>
            {tab}
            {activeTab === tab && <span className={BottomTabs_module_css_1.default.tabIndicator}/>}
          </button>); })}
      </div>
      <div className={BottomTabs_module_css_1.default.tabContent}>
        {activeTab === "trades" && (<ErrorBoundary_1.default fallback={<div className={BottomTabs_module_css_1.default.tabError}>Failed to load trades</div>}>
            <TradesTab_1.default token={token}/>
          </ErrorBoundary_1.default>)}
        {activeTab === "comments" && (<ErrorBoundary_1.default fallback={<div className={BottomTabs_module_css_1.default.tabError}>Failed to load comments</div>}>
            <CommentsTab_1.default token={token}/>
          </ErrorBoundary_1.default>)}
        {activeTab === "holders" && (<ErrorBoundary_1.default fallback={<div className={BottomTabs_module_css_1.default.tabError}>Failed to load holders</div>}>
            <HoldersTab_1.default holders={holders}/>
          </ErrorBoundary_1.default>)}
      </div>
    </>);
}
