"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TradesTab;
var BottomTabs_module_css_1 = require("./BottomTabs.module.css");
var useTradeFeed_1 = require("../../hooks/useTradeFeed");
var format_1 = require("../../utils/format");
function TradesTab(_a) {
    var token = _a.token;
    var trades = (0, useTradeFeed_1.useTokenTrades)(token.address);
    var ticker = token.ticker;
    return (<table className={BottomTabs_module_css_1.default.tradesTable}>
      <thead className={BottomTabs_module_css_1.default.tradesHead}>
        <tr className={BottomTabs_module_css_1.default.tradesHeaderRow}>
          <th className={BottomTabs_module_css_1.default.thLeft}>Account</th>
          <th className={BottomTabs_module_css_1.default.thLeftSmall}>Type</th>
          <th className={BottomTabs_module_css_1.default.thRight}>USDC</th>
          <th className={BottomTabs_module_css_1.default.thRight}>{ticker}</th>
          <th className={BottomTabs_module_css_1.default.thRight}>Time</th>
          <th className={BottomTabs_module_css_1.default.thRightWide}>Txn</th>
        </tr>
      </thead>
      <tbody>
        {trades.map(function (t) {
            var mockTxn = t.id.slice(0, 6);
            var isBuy = t.side === "BUY";
            return (<tr key={t.id} className={BottomTabs_module_css_1.default.tradeRow}>
              <td className={BottomTabs_module_css_1.default.tdLeft}>
                <div className={BottomTabs_module_css_1.default.walletCell}>
                  <div className={BottomTabs_module_css_1.default.walletAvatarPlaceholder}/>
                  <span className={BottomTabs_module_css_1.default.walletAddress}>
                    {t.walletAddress}
                  </span>
                </div>
              </td>
              <td className={(0, format_1.cn)(BottomTabs_module_css_1.default.tdType, isBuy ? BottomTabs_module_css_1.default.tdTypeBuy : BottomTabs_module_css_1.default.tdTypeSell)}>
                {isBuy ? "Buy" : "Sell"}
              </td>
              <td className={BottomTabs_module_css_1.default.tdUsdc}>${t.amountUsd.toLocaleString()}</td>
              <td className={(0, format_1.cn)(BottomTabs_module_css_1.default.tdTokens, isBuy ? BottomTabs_module_css_1.default.tdTokensBuy : BottomTabs_module_css_1.default.tdTokensSell)}>
                {t.tokensAmount}
              </td>
              <td className={BottomTabs_module_css_1.default.tdTime}>{t.timestamp}</td>
              <td className={BottomTabs_module_css_1.default.tdTxn}>
                <span className={BottomTabs_module_css_1.default.txnLink}>{mockTxn}</span>
              </td>
            </tr>);
        })}
      </tbody>
    </table>);
}
