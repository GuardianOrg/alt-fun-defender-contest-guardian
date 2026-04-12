"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DegradedBanner;
var DegradedBanner_module_css_1 = require("./DegradedBanner.module.css");
var useDegradedState_1 = require("../../hooks/useDegradedState");
function DegradedBanner() {
    var degraded = (0, useDegradedState_1.default)();
    if (!degraded)
        return null;
    return (<div className={DegradedBanner_module_css_1.default.banner}>
      <span className={DegradedBanner_module_css_1.default.icon}>!</span>
      <div className={DegradedBanner_module_css_1.default.content}>
        Some data may be incomplete — the indexer is temporarily unavailable.
        Prices and balances shown may not reflect the latest state.
      </div>
    </div>);
}
