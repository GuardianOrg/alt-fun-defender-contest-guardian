"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RightPanel;
var RightPanel_module_css_1 = require("./RightPanel.module.css");
var useTokens_1 = require("../../hooks/useTokens");
var useTradeFeed_1 = require("../../hooks/useTradeFeed");
var format_1 = require("../../utils/format");
function RightPanel() {
    var _a, _b, _c, _d;
    var trades = (0, useTradeFeed_1.useTradeFeed)();
    var tokens = (0, useTokens_1.useTokens)().data;
    var graduating = (_a = tokens === null || tokens === void 0 ? void 0 : tokens.filter(function (t) { return t.status === "graduating"; })) !== null && _a !== void 0 ? _a : [];
    var ltMovers = (_d = (_c = (_b = tokens === null || tokens === void 0 ? void 0 : tokens.filter(function (t) { return t.leverageBoost > 0; })) === null || _b === void 0 ? void 0 : _b.sort(function (a, b) { return b.leverageBoost - a.leverageBoost; })) === null || _c === void 0 ? void 0 : _c.slice(0, 3)) !== null && _d !== void 0 ? _d : [];
    return (<div className={RightPanel_module_css_1.default.panel}>
      {/* Recent trades */}
      <div className={RightPanel_module_css_1.default.section}>
        <div className={(0, format_1.cn)(RightPanel_module_css_1.default.sectionHeader, RightPanel_module_css_1.default.sectionHeaderLive)}>
          RECENT TRADES
          <span className={RightPanel_module_css_1.default.liveIndicator}>
            <span className={RightPanel_module_css_1.default.liveDot}/>
            LIVE
          </span>
        </div>
        <div>
          {trades.map(function (t) {
            var isBuy = t.side === "BUY";
            return (<div key={t.id} className={RightPanel_module_css_1.default.tradeRow}>
                <div className={RightPanel_module_css_1.default.tradeInfo}>
                  <div className={RightPanel_module_css_1.default.tradeNameRow}>
                    <span className={RightPanel_module_css_1.default.tradeName}>{t.tokenName}</span>
                    <span className={RightPanel_module_css_1.default.tradeTime}>{t.timestamp}</span>
                  </div>
                  <div className={RightPanel_module_css_1.default.tradeWallet}>{t.walletAddress}</div>
                </div>
                <span className={(0, format_1.cn)(RightPanel_module_css_1.default.tradeAmount, isBuy ? RightPanel_module_css_1.default.tradeAmountBuy : RightPanel_module_css_1.default.tradeAmountSell)}>
                  {isBuy ? "+" : "-"}${t.amountUsd.toLocaleString()}
                </span>
              </div>);
        })}
        </div>
      </div>

      {/* Graduating soon */}
      {graduating.length > 0 && (<div className={RightPanel_module_css_1.default.section}>
          <div className={RightPanel_module_css_1.default.sectionHeader}>GRADUATING SOON</div>
          {graduating.map(function (t) { return (<div key={t.address} className={(0, format_1.cn)(RightPanel_module_css_1.default.infoRow, RightPanel_module_css_1.default.infoRowNoBorderLast)}>
              <span className={RightPanel_module_css_1.default.infoName}>{t.name}</span>
              <span className={RightPanel_module_css_1.default.graduatingValue}>
                {t.curveFilled}% · {t.direction === "long" ? "LONG" : "SHORT"}
              </span>
            </div>); })}
        </div>)}

      {/* Top LT movers */}
      <div className={RightPanel_module_css_1.default.section}>
        <div className={RightPanel_module_css_1.default.sectionHeader}>TOP LT MOVERS</div>
        {ltMovers.map(function (t) { return (<div key={t.address} className={(0, format_1.cn)(RightPanel_module_css_1.default.infoRow, RightPanel_module_css_1.default.infoRowNoBorderLast)}>
            <span className={RightPanel_module_css_1.default.infoName}>{t.name}</span>
            <span className={RightPanel_module_css_1.default.ltMoverValue}>
              +{t.change24h}% {t.ltName.split(" ").slice(0, 2).join("")}
            </span>
          </div>); })}
      </div>

      {/* My positions — placeholder until GET /portfolio/:wallet is wired */}
      <div>
        <div className={RightPanel_module_css_1.default.sectionHeader}>MY POSITIONS</div>
        <div className={RightPanel_module_css_1.default.infoRow}>
          <span className={RightPanel_module_css_1.default.infoName}>Connect wallet to view</span>
        </div>
      </div>
    </div>);
}
