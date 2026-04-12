"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AssetTape;
var react_1 = require("react");
var AssetTape_module_css_1 = require("./AssetTape.module.css");
var useAssets_1 = require("../../hooks/useAssets");
var format_1 = require("../../utils/format");
function AssetTape() {
    var assets = (0, useAssets_1.useAssets)().data;
    var scrollRef = (0, react_1.useRef)(null);
    if (!assets)
        return null;
    var doubled = __spreadArray(__spreadArray([], assets, true), assets, true);
    var handleKeyDown = function (e) {
        if (!scrollRef.current)
            return;
        var scrollAmount = 150;
        if (e.key === "ArrowRight") {
            e.preventDefault();
            scrollRef.current.scrollLeft += scrollAmount;
        }
        else if (e.key === "ArrowLeft") {
            e.preventDefault();
            scrollRef.current.scrollLeft -= scrollAmount;
        }
    };
    return (<div className={AssetTape_module_css_1.default.tape} role="marquee" aria-label="Live asset prices">
      <div className={AssetTape_module_css_1.default.liveTag} aria-hidden="true">
        <div className={AssetTape_module_css_1.default.liveDot}/>
        LIVE
      </div>
      <div ref={scrollRef} className={AssetTape_module_css_1.default.scrollWrap} tabIndex={0} onKeyDown={handleKeyDown} aria-label="Asset price ticker — use arrow keys to scroll">
        <div className={AssetTape_module_css_1.default.scrollTrack}>
          {doubled.map(function (a, i) { return (<div key={"".concat(a.name, "-").concat(i)} className={AssetTape_module_css_1.default.assetGroup}>
              <div className={AssetTape_module_css_1.default.assetItem}>
                <span className={AssetTape_module_css_1.default.assetName}>{a.name}</span>
                <span className={AssetTape_module_css_1.default.assetPrice}>{a.priceUsd}</span>
                <span className={(0, format_1.cn)(AssetTape_module_css_1.default.assetChange, a.change24h >= 0 ? AssetTape_module_css_1.default.changeMint : AssetTape_module_css_1.default.changeRed)}>
                  {a.change24h >= 0 ? "+" : ""}
                  {a.change24h}%
                </span>
              </div>
              <span className={AssetTape_module_css_1.default.separator} aria-hidden="true"/>
            </div>); })}
        </div>
      </div>
    </div>);
}
