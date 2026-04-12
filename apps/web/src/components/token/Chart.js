"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Chart;
var react_1 = require("react");
var Chart_module_css_1 = require("./Chart.module.css");
var useChart_1 = require("../../hooks/useChart");
var useChartData_1 = require("../../hooks/useChartData");
var format_1 = require("../../utils/format");
var INTERVALS = ["1m", "5m", "15m", "1h", "4h"];
function Chart(_a) {
    var token = _a.token;
    var chartContainerRef = (0, react_1.useRef)(null);
    var _b = (0, react_1.useState)("5m"), interval = _b[0], setInterval = _b[1];
    var _c = (0, react_1.useState)(false), showOverlay = _c[0], setShowOverlay = _c[1];
    var underlyingChg = token.leverage > 0 ? token.leverageBoost / token.leverage : 0;
    var _d = (0, useChartData_1.useChartData)(token.address, interval, token.change24h, showOverlay), candles = _d.candles, overlayData = _d.overlayData, loading = _d.loading;
    (0, useChart_1.useChart)({
        containerRef: chartContainerRef,
        candles: candles,
        overlayData: overlayData,
        loading: loading,
    });
    return (<>
      <div className={Chart_module_css_1.default.toolbar}>
        <div className={Chart_module_css_1.default.intervalGroup}>
          {INTERVALS.map(function (iv) { return (<button key={iv} className={(0, format_1.cn)(Chart_module_css_1.default.intervalBtn, interval === iv && Chart_module_css_1.default.intervalBtnActive)} onClick={function () { return setInterval(iv); }}>
              {iv}
            </button>); })}
        </div>

        <div className={Chart_module_css_1.default.dividerSmall}/>

        <label className={Chart_module_css_1.default.overlayLabel}>
          <div className={(0, format_1.cn)(Chart_module_css_1.default.toggleTrack, showOverlay && Chart_module_css_1.default.toggleTrackOn)} onClick={function () { return setShowOverlay(!showOverlay); }}>
            <div className={(0, format_1.cn)(Chart_module_css_1.default.toggleDot, showOverlay && Chart_module_css_1.default.toggleDotOn)}/>
          </div>
          <span className={(0, format_1.cn)(Chart_module_css_1.default.overlayText, showOverlay && Chart_module_css_1.default.overlayTextOn)}>
            {token.underlying}
          </span>
        </label>

        <div className={Chart_module_css_1.default.dividerSmall}/>

        <div className={Chart_module_css_1.default.decompStats}>
          <span className={Chart_module_css_1.default.decompLabel}>
            buys{" "}
            <span className={token.buyMomentum >= 0
            ? Chart_module_css_1.default.decompValueMint
            : Chart_module_css_1.default.decompValueRed}>
              {(0, format_1.formatPercent)(token.buyMomentum)}
            </span>
          </span>
          <span className={Chart_module_css_1.default.decompLabel}>
            lev{" "}
            <span className={Chart_module_css_1.default.decompAmber}>
              {(0, format_1.formatPercent)(token.leverageBoost)}
            </span>
            <span className={Chart_module_css_1.default.decompDetail}>
              ({(0, format_1.formatPercent)(underlyingChg)}×{token.leverage})
            </span>
          </span>
        </div>

        <div className={Chart_module_css_1.default.liveIndicator}>
          <div className={Chart_module_css_1.default.liveDot}/>
          <span className={Chart_module_css_1.default.liveText}>live</span>
        </div>
      </div>
      <div ref={chartContainerRef} className={Chart_module_css_1.default.chartArea}/>
    </>);
}
