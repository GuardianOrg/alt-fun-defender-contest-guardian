"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LeverageBanner;
var react_1 = require("react");
var LeverageBanner_module_css_1 = require("./LeverageBanner.module.css");
var STORAGE_KEY = "bf_lev_banner_v2";
function LeverageBanner() {
    var _a = (0, react_1.useState)(function () { return sessionStorage.getItem(STORAGE_KEY) === "1"; }), dismissed = _a[0], setDismissed = _a[1];
    if (dismissed)
        return null;
    var dismiss = function () {
        sessionStorage.setItem(STORAGE_KEY, "1");
        setDismissed(true);
    };
    return (<div className={LeverageBanner_module_css_1.default.banner}>
      <span className={LeverageBanner_module_css_1.default.emoji}>⚡</span>
      <div className={LeverageBanner_module_css_1.default.content}>
        Every token is backed by a{" "}
        <span className={LeverageBanner_module_css_1.default.highlightMint}>
          non-liquidating leveraged position
        </span>{" "}
        on Hyperliquid. Your token pumps even when nobody's buying — the
        underlying moves, your coin moves{" "}
        <span className={LeverageBanner_module_css_1.default.highlightAmber}>2–5× harder</span>.
      </div>
      <button className={LeverageBanner_module_css_1.default.dismissButton} onClick={dismiss} title="Dismiss">
        ✕
      </button>
    </div>);
}
