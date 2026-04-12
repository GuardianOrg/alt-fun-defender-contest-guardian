"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Chart;
var react_1 = require("react");
var lightweight_charts_1 = require("lightweight-charts");
var Chart_module_css_1 = require("./Chart.module.css");
var colors_1 = require("../../config/colors");
var format_1 = require("../../utils/format");
var api_1 = require("../../services/api");
var INTERVALS = ["1m", "5m", "15m", "1h", "4h"];
function generateCandles(count, startPrice, changePct, vol) {
    var data = [];
    var v = startPrice;
    var tr = changePct / count;
    var baseTime = Math.floor(Date.now() / 1000) - count * 60;
    for (var i = 0; i < count; i++) {
        var n = (Math.random() - 0.48) * vol;
        v = Math.max(v * (1 + tr / 100 + n / 100), startPrice * 0.2);
        var o = v;
        var c = v * (1 + (Math.random() - 0.5) * 0.008);
        var h = Math.max(o, c) * (1 + Math.random() * 0.005);
        var l = Math.min(o, c) * (1 - Math.random() * 0.005);
        data.push({
            time: (baseTime + i * 60),
            open: o,
            high: h,
            low: l,
            close: c,
        });
    }
    return data;
}
function generateOverlay(count, startPrice, changePct) {
    var data = [];
    var v = startPrice;
    var tr = changePct / count;
    var baseTime = Math.floor(Date.now() / 1000) - count * 60;
    for (var i = 0; i < count; i++) {
        var n = (Math.random() - 0.48) * 1.2;
        v = v * (1 + tr / 100 + n / 100);
        data.push({
            time: (baseTime + i * 60),
            value: v,
        });
    }
    return data;
}
function fetchChartData(address, interval) {
    return __awaiter(this, void 0, void 0, function () {
        var candles, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, api_1.fetchOhlcv)(address, interval)];
                case 1:
                    candles = _b.sent();
                    if (candles.length === 0)
                        return [2 /*return*/, []];
                    return [2 /*return*/, candles.map(function (c) { return ({
                            time: c.time,
                            open: c.open,
                            high: c.high,
                            low: c.low,
                            close: c.close,
                        }); })];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, []];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function Chart(_a) {
    var token = _a.token;
    var chartContainerRef = (0, react_1.useRef)(null);
    var chartRef = (0, react_1.useRef)(null);
    var candleSeriesRef = (0, react_1.useRef)(null);
    var lineSeriesRef = (0, react_1.useRef)(null);
    var _b = (0, react_1.useState)("5m"), interval = _b[0], setInterval = _b[1];
    var _c = (0, react_1.useState)(false), showOverlay = _c[0], setShowOverlay = _c[1];
    var underlyingChg = token.leverage > 0 ? token.leverageBoost / token.leverage : 0;
    (0, react_1.useEffect)(function () {
        if (!chartContainerRef.current)
            return;
        var disposed = false;
        var chart = (0, lightweight_charts_1.createChart)(chartContainerRef.current, {
            layout: {
                background: { type: lightweight_charts_1.ColorType.Solid, color: "transparent" },
                textColor: "rgba(234,250,244,0.22)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
            },
            grid: {
                vertLines: { color: (0, colors_1.rgba)(colors_1.COLORS.mint, 0.05) },
                horzLines: { color: (0, colors_1.rgba)(colors_1.COLORS.mint, 0.05) },
            },
            crosshair: {
                vertLine: { color: (0, colors_1.rgba)(colors_1.COLORS.mint, 0.25) },
                horzLine: { color: (0, colors_1.rgba)(colors_1.COLORS.mint, 0.25) },
            },
            rightPriceScale: { borderColor: (0, colors_1.rgba)(colors_1.COLORS.mint, 0.1) },
            timeScale: { borderColor: (0, colors_1.rgba)(colors_1.COLORS.mint, 0.1) },
        });
        chartRef.current = chart;
        var candleSeries = chart.addSeries(lightweight_charts_1.CandlestickSeries, {
            upColor: colors_1.COLORS.mint,
            downColor: colors_1.COLORS.red,
            borderUpColor: colors_1.COLORS.mint,
            borderDownColor: colors_1.COLORS.red,
            wickUpColor: colors_1.COLORS.mint,
            wickDownColor: colors_1.COLORS.red,
        });
        candleSeriesRef.current = candleSeries;
        fetchChartData(token.address, interval).then(function (apiCandles) {
            if (disposed)
                return;
            if (apiCandles.length > 0) {
                candleSeries.setData(apiCandles);
            }
            else {
                var pts = interval === "1m" ? 120 : interval === "5m" ? 96 : interval === "15m" ? 72 : interval === "1h" ? 60 : 48;
                candleSeries.setData(generateCandles(pts, 0.0001, token.change24h, interval === "1m" ? 3 : 1.8));
            }
            chart.timeScale().fitContent();
        });
        var handleResize = function () {
            if (chartContainerRef.current) {
                chart.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                });
            }
        };
        window.addEventListener("resize", handleResize);
        handleResize();
        return function () {
            disposed = true;
            window.removeEventListener("resize", handleResize);
            chart.remove();
        };
    }, [interval, token.address, token.change24h]);
    (0, react_1.useEffect)(function () {
        var chart = chartRef.current;
        if (!chart)
            return;
        if (lineSeriesRef.current) {
            chart.removeSeries(lineSeriesRef.current);
            lineSeriesRef.current = null;
        }
        if (showOverlay) {
            var pts = interval === "1m" ? 120 : interval === "5m" ? 96 : interval === "15m" ? 72 : interval === "1h" ? 60 : 48;
            var lineSeries = chart.addSeries(lightweight_charts_1.LineSeries, {
                color: (0, colors_1.rgba)(colors_1.COLORS.amber, 0.5),
                lineWidth: 1,
                priceScaleId: "overlay",
            });
            lineSeries.setData(generateOverlay(pts, 14, 8.2));
            lineSeriesRef.current = lineSeries;
        }
    }, [showOverlay, interval]);
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
