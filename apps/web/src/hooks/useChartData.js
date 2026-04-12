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
exports.useChartData = useChartData;
var react_1 = require("react");
var api_1 = require("../services/api");
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
function getPointCount(interval) {
    return interval === "1m"
        ? 120
        : interval === "5m"
            ? 96
            : interval === "15m"
                ? 72
                : interval === "1h"
                    ? 60
                    : 48;
}
function fetchChartCandles(address, interval) {
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
function useChartData(address, interval, change24h, showOverlay) {
    var _a = (0, react_1.useState)([]), candles = _a[0], setCandles = _a[1];
    var _b = (0, react_1.useState)([]), overlayData = _b[0], setOverlayData = _b[1];
    var _c = (0, react_1.useState)(true), loading = _c[0], setLoading = _c[1];
    (0, react_1.useEffect)(function () {
        var cancelled = false;
        setLoading(true);
        fetchChartCandles(address, interval).then(function (apiCandles) {
            if (cancelled)
                return;
            if (apiCandles.length > 0) {
                setCandles(apiCandles);
            }
            else {
                var pts = getPointCount(interval);
                setCandles(generateCandles(pts, 0.0001, change24h, interval === "1m" ? 3 : 1.8));
            }
            setLoading(false);
        });
        return function () {
            cancelled = true;
        };
    }, [address, interval, change24h]);
    (0, react_1.useEffect)(function () {
        if (showOverlay) {
            var pts = getPointCount(interval);
            setOverlayData(generateOverlay(pts, 14, 8.2));
        }
        else {
            setOverlayData([]);
        }
    }, [showOverlay, interval]);
    return { candles: candles, overlayData: overlayData, loading: loading };
}
