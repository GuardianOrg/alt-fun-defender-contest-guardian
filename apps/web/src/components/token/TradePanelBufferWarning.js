"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TradePanelBufferWarning;
var TradePanel_module_css_1 = require("./TradePanel.module.css");
function TradePanelBufferWarning(_a) {
    var sellQuote = _a.sellQuote, ticker = _a.ticker;
    return (<div className={TradePanel_module_css_1.default.bufferWarning}>
      <span className={TradePanel_module_css_1.default.bufferWarningTitle}>Sell amount exceeds available liquidity</span>
      <span>
        Max sellable now:{" "}
        <span className={TradePanel_module_css_1.default.bufferWarningMax}>
          {sellQuote.maxSellableTokens.toLocaleString(undefined, {
            maximumFractionDigits: 2,
        })}
        </span>{" "}
        {ticker}
        {" "}(~${sellQuote.bufferUsdc.toLocaleString(undefined, {
            maximumFractionDigits: 2,
        })} USDC available)
      </span>
      <span className={TradePanel_module_css_1.default.bufferWarningHint}>
        Sell in smaller amounts. Liquidity replenishes in ~10s after each sell.
      </span>
    </div>);
}
