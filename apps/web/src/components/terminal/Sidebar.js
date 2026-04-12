"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Sidebar;
var react_router_1 = require("react-router");
var Sidebar_module_css_1 = require("./Sidebar.module.css");
var routes_1 = require("../../app/routes");
var useAssets_1 = require("../../hooks/useAssets");
var format_1 = require("../../utils/format");
function Sidebar() {
    var navigate = (0, react_router_1.useNavigate)();
    var assets = (0, useAssets_1.useAssets)().data;
    (0, useAssets_1.usePlatformStats)();
    var filters = (0, useAssets_1.usePairFilters)().data;
    return (<div className={Sidebar_module_css_1.default.sidebar}>
      {/* Asset prices */}
      <div className={Sidebar_module_css_1.default.section}>
        <div className={Sidebar_module_css_1.default.sectionHeader}>MARKETS</div>
        {assets === null || assets === void 0 ? void 0 : assets.map(function (a, i) { return (<div key={a.name} className={(0, format_1.cn)(Sidebar_module_css_1.default.assetRow, i < assets.length - 1 && Sidebar_module_css_1.default.assetRowBorder)}>
            <div>
              <div className={Sidebar_module_css_1.default.assetName}>{a.name}</div>
              <div className={(0, format_1.cn)(Sidebar_module_css_1.default.assetChange, a.change24h >= 0
                ? Sidebar_module_css_1.default.assetChangeUp
                : Sidebar_module_css_1.default.assetChangeDown)}>
                {a.change24h >= 0 ? "+" : ""}
                {a.change24h.toFixed(2)}%
              </div>
            </div>
            <div className={Sidebar_module_css_1.default.assetPrice}>{a.priceUsd}</div>
          </div>); })}
      </div>

      {/* Pair filters */}
      {filters && (<div className={Sidebar_module_css_1.default.section}>
          <div className={Sidebar_module_css_1.default.pairsHeader}>PAIRS</div>
          {filters.map(function (f) { return (<div key={"".concat(f.asset, "-").concat(f.direction)} className={Sidebar_module_css_1.default.pairRow}>
              <div className={Sidebar_module_css_1.default.pairDot} style={{ background: f.color }}/>
              <span className={Sidebar_module_css_1.default.pairName}>
                {f.asset} {f.direction === "long" ? "Long" : "Short"}
              </span>
              <span className={Sidebar_module_css_1.default.pairCount}>{f.count}</span>
            </div>); })}
        </div>)}

      {/* Launch CTA */}
      <div className={Sidebar_module_css_1.default.ctaSection}>
        <button className={Sidebar_module_css_1.default.ctaButton} onClick={function () { return navigate(routes_1.CREATE_PATH); }}>
          <span className={Sidebar_module_css_1.default.ctaEmoji}>&#x26A1;</span>
          <span className={Sidebar_module_css_1.default.ctaText}>
            <span className={Sidebar_module_css_1.default.ctaTitle}>create</span>
            <span className={Sidebar_module_css_1.default.ctaSub}>launch a levered token</span>
          </span>
        </button>
      </div>
    </div>);
}
