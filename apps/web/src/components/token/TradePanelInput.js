"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TradePanelInput;
var TradePanel_module_css_1 = require("./TradePanel.module.css");
var constants_1 = require("../../config/constants");
var format_1 = require("../../utils/format");
function TradePanelInput(_a) {
    var mode = _a.mode, amount = _a.amount, setAmount = _a.setAmount, isBusy = _a.isBusy, maxBalance = _a.maxBalance, sellQuote = _a.sellQuote, token = _a.token;
    var ticker = token.ticker;
    return (<>
      <div className={TradePanel_module_css_1.default.denomToggle}>
        {mode === "buy" ? "Amount in USDC" : "Amount in ".concat(ticker)}
      </div>

      <div className={TradePanel_module_css_1.default.amountWrap}>
        <input className={TradePanel_module_css_1.default.amountInput} type="number" placeholder="0.00" value={amount} onChange={function (e) { return setAmount(e.target.value); }} disabled={isBusy}/>
        <div className={TradePanel_module_css_1.default.denomTag}>
          <span className={TradePanel_module_css_1.default.denomLabel}>
            {mode === "buy" ? "USDC" : ticker}
          </span>
          <div className={(0, format_1.cn)(TradePanel_module_css_1.default.coinIcon, mode === "buy" ? TradePanel_module_css_1.default.coinUsdc : TradePanel_module_css_1.default.coinRed)}>
            {mode === "buy" ? ("$") : token.image ? (<img src={token.image} alt="" className={TradePanel_module_css_1.default.coinImg}/>) : (token.emoji)}
          </div>
        </div>
      </div>

      <div className={TradePanel_module_css_1.default.quickRow}>
        <button className={TradePanel_module_css_1.default.resetBtn} onClick={function () { return setAmount(""); }} disabled={isBusy}>
          Reset
        </button>
        {constants_1.QUICK_AMOUNTS.map(function (qa) { return (<button key={qa} className={(0, format_1.cn)(TradePanel_module_css_1.default.quickBtn, amount === String(qa) && TradePanel_module_css_1.default.quickBtnActive)} onClick={function () {
                setAmount(String(qa));
            }} disabled={isBusy}>
            {qa >= 1000 ? "".concat(qa / 1000, "K") : qa}
          </button>); })}
        <button className={TradePanel_module_css_1.default.maxBtn} onClick={function () {
            if (maxBalance) {
                var walletBal = parseFloat(maxBalance);
                if (mode === "buy") {
                    setAmount(String(Math.floor(walletBal * 100) / 100));
                }
                else if (sellQuote && Number.isFinite(sellQuote.maxSellableTokens)) {
                    var capped = Math.min(walletBal, sellQuote.maxSellableTokens);
                    setAmount(String(Math.max(0, capped)));
                }
                else {
                    setAmount(String(walletBal));
                }
            }
        }} disabled={isBusy || !maxBalance}>
          Max
        </button>
      </div>
    </>);
}
