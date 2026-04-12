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
exports.default = HoldersTab;
var BottomTabs_module_css_1 = require("./BottomTabs.module.css");
var format_1 = require("../../utils/format");
function HoldersTab(_a) {
    var holders = _a.holders;
    var maxSupply = Math.max.apply(Math, __spreadArray(__spreadArray([], holders.map(function (h) { return h.percentSupply; }), false), [1], false));
    return (<div className={BottomTabs_module_css_1.default.holdersWrap}>
      <div className={BottomTabs_module_css_1.default.holdersHeader}>
        <div>#</div>
        <div>wallet</div>
        <div>tokens</div>
        <div>% supply</div>
        <div>bar</div>
      </div>
      {holders.map(function (h) { return (<div key={h.rank} className={BottomTabs_module_css_1.default.holderRow}>
          <div className={BottomTabs_module_css_1.default.holderRank}>{h.rank}</div>
          <div className={BottomTabs_module_css_1.default.holderAddress}>
            {h.address}
            {h.isCreator && (<span className={BottomTabs_module_css_1.default.holderCreator}>creator</span>)}
          </div>
          <div className={BottomTabs_module_css_1.default.holderTokens}>{h.tokens}</div>
          <div className={BottomTabs_module_css_1.default.holderPercent}>{h.percentSupply}%</div>
          <div>
            <div className={BottomTabs_module_css_1.default.barTrack}>
              <div className={(0, format_1.cn)(BottomTabs_module_css_1.default.barFill, "bar-glow-mint")} style={{ width: "".concat((h.percentSupply / maxSupply) * 100, "%") }}/>
            </div>
          </div>
        </div>); })}
    </div>);
}
