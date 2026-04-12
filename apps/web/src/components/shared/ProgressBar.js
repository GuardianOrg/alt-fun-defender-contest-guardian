"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ProgressBar;
var react_1 = require("react");
var ProgressBar_module_css_1 = require("./ProgressBar.module.css");
var format_1 = require("../../utils/format");
function ProgressBar(_a) {
    var buyPercent = _a.buyPercent, leveragePercent = _a.leveragePercent, _b = _a.isShort, isShort = _b === void 0 ? false : _b, _c = _a.isGraduating, isGraduating = _c === void 0 ? false : _c, label = _a.label, _d = _a.showLegend, showLegend = _d === void 0 ? false : _d, buyUsd = _a.buyUsd, leverageUsd = _a.leverageUsd, _e = _a.size, size = _e === void 0 ? "sm" : _e;
    var _f = (0, react_1.useState)(false), tooltip = _f[0], setTooltip = _f[1];
    var trackRef = (0, react_1.useRef)(null);
    var _g = (0, react_1.useState)({ x: 0, y: 0 }), tipPos = _g[0], setTipPos = _g[1];
    var buyPctDisplay = Math.round(buyPercent);
    var levPctDisplay = Math.round(leveragePercent * 10) / 10;
    return (<div className={ProgressBar_module_css_1.default.wrapper}>
      <div ref={trackRef} className={(0, format_1.cn)(ProgressBar_module_css_1.default.track, leveragePercent > 0 ? ProgressBar_module_css_1.default.overflowVisible : ProgressBar_module_css_1.default.overflowHidden, size === "sm" ? ProgressBar_module_css_1.default.trackSm : ProgressBar_module_css_1.default.trackMd)} onMouseEnter={function () { return setTooltip(true); }} onMouseMove={function (e) { return setTipPos({ x: e.clientX + 12, y: e.clientY - 60 }); }} onMouseLeave={function () { return setTooltip(false); }}>
        <div className={(0, format_1.cn)(ProgressBar_module_css_1.default.buySegment, "bar-glow-mint", isGraduating && ProgressBar_module_css_1.default.graduating)} style={{ width: "".concat(buyPercent, "%") }}/>
        {leveragePercent > 0 && (<div className={(0, format_1.cn)(ProgressBar_module_css_1.default.leverageSegment, "leverage-fire", isShort ? "leverage-fire-red" : "leverage-fire-mint")} style={{
                left: "".concat(buyPercent, "%"),
                width: "".concat(leveragePercent, "%"),
            }}/>)}
      </div>

      {label && (<div className={ProgressBar_module_css_1.default.labelWrap}>
          <span className={ProgressBar_module_css_1.default.labelText}>{label}</span>
        </div>)}

      {showLegend && (<div className={ProgressBar_module_css_1.default.legend}>
          <div className={ProgressBar_module_css_1.default.legendItem}>
            <div className={(0, format_1.cn)(ProgressBar_module_css_1.default.legendDot, "bar-glow-mint")}/>
            buy pressure{buyUsd && " \u00B7 ".concat(buyUsd)}
          </div>
          <div className={ProgressBar_module_css_1.default.legendItem}>
            <div className={(0, format_1.cn)(ProgressBar_module_css_1.default.legendDotLeverage, "leverage-fire-dot", isShort ? "leverage-fire-dot-red" : "leverage-fire-dot-mint")}/>
            leverage boost{leverageUsd && " \u00B7 ".concat(leverageUsd)}
          </div>
        </div>)}

      {tooltip && leveragePercent > 0 && (<div className={ProgressBar_module_css_1.default.tooltip} style={{
                left: Math.min(tipPos.x, window.innerWidth - 200),
                top: tipPos.y,
            }}>
          <div className={ProgressBar_module_css_1.default.tooltipRow}>
            <div className={ProgressBar_module_css_1.default.tooltipDotMint}/>
            <span className={ProgressBar_module_css_1.default.tooltipLabel}>buy pressure</span>
            <span className={ProgressBar_module_css_1.default.tooltipValueMint}>{buyPctDisplay}%</span>
          </div>
          <div className={ProgressBar_module_css_1.default.tooltipRowLast}>
            <div className={(0, format_1.cn)(ProgressBar_module_css_1.default.tooltipDotBase, isShort ? ProgressBar_module_css_1.default.dotRed : ProgressBar_module_css_1.default.dotAqua)}/>
            <span className={ProgressBar_module_css_1.default.tooltipLabel}>leverage boost</span>
            <span className={ProgressBar_module_css_1.default.tooltipValueAmber}>{levPctDisplay}%</span>
          </div>
        </div>)}
    </div>);
}
