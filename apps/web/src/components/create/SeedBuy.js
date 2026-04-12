"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SeedBuy;
var react_1 = require("react");
var SeedBuy_module_css_1 = require("./SeedBuy.module.css");
var StepHeader_1 = require("./StepHeader");
var constants_1 = require("../../config/constants");
var format_1 = require("../../utils/format");
function SeedBuy(_a) {
    var seedAmount = _a.seedAmount, onSeedChange = _a.onSeedChange;
    var _b = (0, react_1.useState)(null), activePct = _b[0], setActivePct = _b[1];
    var amt = parseFloat(seedAmount) || 0;
    var supplyPct = amt > 0 ? Math.min((amt / constants_1.GRADUATION_THRESHOLD_USD) * 75, 99) : 0;
    var tokensReceived = amt > 0 ? "".concat(((constants_1.TOKEN_SUPPLY * supplyPct) / 100 / 1e6).toFixed(1), "M") : "—";
    var supplyStr = amt > 0 ? "".concat(supplyPct.toFixed(1), "%") : "—";
    var curveStr = amt > 0 ? "".concat(((amt / constants_1.GRADUATION_THRESHOLD_USD) * 100).toFixed(1), "%") : "—";
    return (<div>
      <StepHeader_1.default step={3} title="Seed buy" subtitle="Buy tokens before anyone else. Sets the opening price."/>

      <div className={SeedBuy_module_css_1.default.card}>
        <div className={SeedBuy_module_css_1.default.amountRow}>
          <span className={SeedBuy_module_css_1.default.dollarSign}>$</span>
          <input type="number" className={SeedBuy_module_css_1.default.amountInput} placeholder="0.00" value={seedAmount} onChange={function (e) {
            onSeedChange(e.target.value);
            setActivePct(null);
        }} min="0"/>
        </div>

        <div className={SeedBuy_module_css_1.default.quickGrid}>
          {constants_1.SEED_PCT_OPTIONS.map(function (opt) { return (<button key={opt.pct} className={(0, format_1.cn)(SeedBuy_module_css_1.default.quickButton, activePct === opt.pct
                ? SeedBuy_module_css_1.default.quickButtonActive
                : SeedBuy_module_css_1.default.quickButtonInactive)} onClick={function () {
                onSeedChange(String(opt.usd));
                setActivePct(opt.pct);
            }}>
              <div className={SeedBuy_module_css_1.default.quickLabel}>{opt.pct}%</div>
              <div className={SeedBuy_module_css_1.default.quickSub}>${opt.usd.toLocaleString()}</div>
            </button>); })}
        </div>

        <div className={SeedBuy_module_css_1.default.statsGrid}>
          {[
            { label: "tokens received", value: tokensReceived, cls: "" },
            { label: "% of supply", value: supplyStr, cls: SeedBuy_module_css_1.default.textMint },
            { label: "curve filled", value: curveStr, cls: "" },
        ].map(function (s) { return (<div key={s.label} className={SeedBuy_module_css_1.default.statCard}>
              <div className={SeedBuy_module_css_1.default.statLabel}>{s.label}</div>
              <div className={(0, format_1.cn)(SeedBuy_module_css_1.default.statValue, s.cls)}>{s.value}</div>
            </div>); })}
        </div>
      </div>

      {amt <= 0 && (<div className={SeedBuy_module_css_1.default.skipHint}>
          Skip this step to launch with zero initial buy
        </div>)}
    </div>);
}
