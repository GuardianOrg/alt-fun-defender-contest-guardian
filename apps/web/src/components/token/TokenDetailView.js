"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TokenDetailView;
var react_router_1 = require("react-router");
var BottomTabs_1 = require("./BottomTabs");
var Chart_1 = require("./Chart");
var HeroSection_1 = require("./HeroSection");
var TokenDetailView_module_css_1 = require("./TokenDetailView.module.css");
var TradePanel_1 = require("./TradePanel");
var constants_1 = require("../../config/constants");
var useToken_1 = require("../../hooks/useToken");
var format_1 = require("../../utils/format");
var ProgressBar_1 = require("../shared/ProgressBar");
function TokenDetailView() {
    var address = (0, react_router_1.useParams)().address;
    var _a = (0, useToken_1.useToken)(address), token = _a.data, isLoading = _a.isLoading, isError = _a.isError;
    if (isLoading) {
        return (<div className={TokenDetailView_module_css_1.default.wrapper}>
        <div className={TokenDetailView_module_css_1.default.loading}>Loading token...</div>
      </div>);
    }
    if (isError || !token) {
        return (<div className={TokenDetailView_module_css_1.default.wrapper}>
        <div className={TokenDetailView_module_css_1.default.loading}>Token not found</div>
      </div>);
    }
    var buyW = Math.round(token.curveFilled -
        (token.leverageBoost > 0
            ? (token.leverageBoost / token.change24h) * token.curveFilled
            : 0));
    var levW = token.curveFilled - buyW;
    return (<div className={TokenDetailView_module_css_1.default.wrapper}>
      <div className={TokenDetailView_module_css_1.default.leftPanel}>
        <HeroSection_1.default token={token}/>
        <Chart_1.default token={token}/>

        {token.status !== "graduated" && (<div className={TokenDetailView_module_css_1.default.curveStrip}>
            <span className={TokenDetailView_module_css_1.default.curveLabel}>curve</span>
            <span className={TokenDetailView_module_css_1.default.curveRaised}>
              {(0, format_1.formatUsd)(token.curveRaisedUsd)}
            </span>
            <div className={TokenDetailView_module_css_1.default.progressWrapper}>
              <ProgressBar_1.default buyPercent={buyW} leveragePercent={levW} isShort={token.direction === "short"} isGraduating={token.status === "graduating"} size="sm"/>
            </div>
            <span className={TokenDetailView_module_css_1.default.curveThreshold}>
              {(0, format_1.formatUsd)(constants_1.GRADUATION_THRESHOLD_USD)}
            </span>
            {token.status === "graduating" && (<span className={TokenDetailView_module_css_1.default.graduatingBadge}>graduating</span>)}
          </div>)}

        <BottomTabs_1.default token={token}/>
      </div>

      <TradePanel_1.default token={token}/>
    </div>);
}
