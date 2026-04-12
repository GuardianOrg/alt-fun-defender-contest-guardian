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
exports.useTradeFeed = useTradeFeed;
exports.useTokenTrades = useTokenTrades;
var react_1 = require("react");
var tradeService_1 = require("../services/tradeService");
function useTradeFeed(maxItems) {
    if (maxItems === void 0) { maxItems = 14; }
    var _a = (0, react_1.useState)([]), trades = _a[0], setTrades = _a[1];
    (0, react_1.useEffect)(function () {
        var unsub = tradeService_1.tradeService.subscribeFeed(function (trade) {
            setTrades(function (prev) { return __spreadArray([trade], prev, true).slice(0, maxItems); });
        });
        return function () { return unsub(); };
    }, [maxItems]);
    return trades;
}
function useTokenTrades(address, maxItems) {
    if (maxItems === void 0) { maxItems = 30; }
    var _a = (0, react_1.useState)(function () {
        return address ? tradeService_1.tradeService.getInitialTrades(address) : [];
    }), trades = _a[0], setTrades = _a[1];
    (0, react_1.useEffect)(function () {
        if (!address)
            return;
        setTrades(tradeService_1.tradeService.getInitialTrades(address));
        var unsub = tradeService_1.tradeService.subscribeTokenTrades(address, function (trade) {
            setTrades(function (prev) { return __spreadArray([trade], prev, true).slice(0, maxItems); });
        });
        return function () { return unsub(); };
    }, [address, maxItems]);
    return trades;
}
