"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = BalancesTab;
var EarningsPanel_module_css_1 = require("./EarningsPanel.module.css");
var format_1 = require("../../utils/format");
function BalancesTab(_a) {
    var tokens = _a.tokens, totalValue = _a.totalValue, onTokenClick = _a.onTokenClick, onLaunch = _a.onLaunch;
    if (tokens.length === 0) {
        return (<div className={EarningsPanel_module_css_1.default.emptyState}>
        <div className={EarningsPanel_module_css_1.default.emptyIcon}>&#x1F4ED;</div>
        <div className={EarningsPanel_module_css_1.default.textCenter}>
          <div className={EarningsPanel_module_css_1.default.emptyTitle}>No tokens yet</div>
          <div className={EarningsPanel_module_css_1.default.emptyText}>
            Buy tokens on the bonding curve or launch your own levered token.
          </div>
        </div>
        <button className={EarningsPanel_module_css_1.default.launchBtn} onClick={onLaunch}>
          &#x26A1; Launch a token
        </button>
      </div>);
    }
    return (<>
      <div className={EarningsPanel_module_css_1.default.totalValueWrap}>
        <div className={EarningsPanel_module_css_1.default.totalValueLabel}>total value</div>
        <div className={EarningsPanel_module_css_1.default.totalValueAmount}>{(0, format_1.formatUsd)(totalValue)}</div>
      </div>

      <div className={EarningsPanel_module_css_1.default.listHeader}>
        <span className={EarningsPanel_module_css_1.default.listHeaderLeft}>Coins</span>
        <span className={EarningsPanel_module_css_1.default.listHeaderRight}>Value</span>
      </div>

      <div className={EarningsPanel_module_css_1.default.tokenList}>
        {tokens.map(function (t) { return (<div key={t.address} className={EarningsPanel_module_css_1.default.tokenRow} onClick={function () { return onTokenClick(t.address); }}>
            <span className={EarningsPanel_module_css_1.default.tokenEmoji}>{t.emoji}</span>
            <div className={EarningsPanel_module_css_1.default.tokenInfo}>
              <div className={EarningsPanel_module_css_1.default.tokenName}>{t.name}</div>
              <div className={EarningsPanel_module_css_1.default.tokenAmount}>
                {(0, format_1.formatTokenAmount)(t.amount)} {t.ticker}
              </div>
            </div>
            <div className={EarningsPanel_module_css_1.default.tokenValueWrap}>
              <div className={EarningsPanel_module_css_1.default.tokenValue}>{(0, format_1.formatUsd)(t.valueUsd)}</div>
              <div className={(0, format_1.cn)(EarningsPanel_module_css_1.default.tokenChange, t.change24h > 0
                ? EarningsPanel_module_css_1.default.changeMint
                : t.change24h < 0
                    ? EarningsPanel_module_css_1.default.changeRed
                    : EarningsPanel_module_css_1.default.changeTxt3)}>
                {(0, format_1.formatPercent)(t.change24h)}
              </div>
            </div>
          </div>); })}
      </div>
    </>);
}
