"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TradePanelQuote;
var TradePanel_module_css_1 = require("./TradePanel.module.css");
function TradePanelQuote(_a) {
    var _b;
    var mode = _a.mode, ticker = _a.ticker, buyQuote = _a.buyQuote, sellQuote = _a.sellQuote;
    return (<div className={TradePanel_module_css_1.default.estimate}>
      {mode === "buy" ? (<>
          ≈ you receive{" "}
          <span className={TradePanel_module_css_1.default.estimateValue}>
            {(_b = buyQuote === null || buyQuote === void 0 ? void 0 : buyQuote.tokensOut) !== null && _b !== void 0 ? _b : "…"}
          </span>{" "}
          <span className={TradePanel_module_css_1.default.estimateMint}>{ticker}</span>
          {buyQuote && buyQuote.priceImpactPct > 1 && (<span className={TradePanel_module_css_1.default.impactWarning}>
              {" "}({buyQuote.priceImpactPct.toFixed(1)}% impact)
            </span>)}
        </>) : (<>
          ≈ you receive{" "}
          <span className={TradePanel_module_css_1.default.estimateValue}>
            ${sellQuote
                ? sellQuote.youReceive.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                })
                : "…"}
          </span>{" "}
          <span className={TradePanel_module_css_1.default.estimateLabel}>USDC</span>
          {sellQuote && sellQuote.priceImpactPct > 1 && (<span className={TradePanel_module_css_1.default.impactWarning}>
              {" "}({sellQuote.priceImpactPct.toFixed(1)}% impact)
            </span>)}
        </>)}
    </div>);
}
