"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useChart = useChart;
var react_1 = require("react");
var lightweight_charts_1 = require("lightweight-charts");
var colors_1 = require("../config/colors");
function useChart(_a) {
    var containerRef = _a.containerRef, candles = _a.candles, overlayData = _a.overlayData, loading = _a.loading;
    var chartRef = (0, react_1.useRef)(null);
    var candleSeriesRef = (0, react_1.useRef)(null);
    var lineSeriesRef = (0, react_1.useRef)(null);
    // Initialize chart
    (0, react_1.useEffect)(function () {
        if (!containerRef.current)
            return;
        var chart = (0, lightweight_charts_1.createChart)(containerRef.current, {
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
        var handleResize = function () {
            if (containerRef.current) {
                chart.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
            }
        };
        window.addEventListener("resize", handleResize);
        handleResize();
        return function () {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            lineSeriesRef.current = null;
        };
    }, [containerRef]);
    // Update candle data
    (0, react_1.useEffect)(function () {
        if (loading || !candleSeriesRef.current || !chartRef.current)
            return;
        candleSeriesRef.current.setData(candles);
        chartRef.current.timeScale().fitContent();
    }, [candles, loading]);
    // Update overlay
    (0, react_1.useEffect)(function () {
        var chart = chartRef.current;
        if (!chart)
            return;
        if (lineSeriesRef.current) {
            chart.removeSeries(lineSeriesRef.current);
            lineSeriesRef.current = null;
        }
        if (overlayData.length > 0) {
            var lineSeries = chart.addSeries(lightweight_charts_1.LineSeries, {
                color: (0, colors_1.rgba)(colors_1.COLORS.amber, 0.5),
                lineWidth: 1,
                priceScaleId: "overlay",
            });
            lineSeries.setData(overlayData);
            lineSeriesRef.current = lineSeries;
        }
    }, [overlayData]);
}
