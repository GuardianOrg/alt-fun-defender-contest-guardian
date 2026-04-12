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
var AssetTape_module_css_1 = require("./AssetTape.module.css");
var useAssets_1 = require("../../hooks/useAssets");
var format_1 = require("../../utils/format");
function AssetTape() {
    var assets = (0, useAssets_1.useAssets)().data;
    if (!assets)
        return null;
    var doubled = __spreadArray(__spreadArray([], assets, true), assets, true);
    return (<div className={AssetTape_module_css_1.default.tape}>
      <div className={AssetTape_module_css_1.default.liveTag}>
        <div className={AssetTape_module_css_1.default.liveDot}/>
        LIVE
      </div>
      <div className={AssetTape_module_css_1.default.scrollWrap}>
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
              <span className={AssetTape_module_css_1.default.separator}/>
            </div>); })}
        </div>
      </div>
    </div>);
}
