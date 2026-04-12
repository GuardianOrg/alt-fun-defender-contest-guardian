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
exports.subscribeFeed = subscribeFeed;
exports.subscribeTokenTrades = subscribeTokenTrades;
var exchangeRates_1 = require("./exchangeRates");
var trades_1 = require("./mock/trades");
var ponder_1 = require("./ponder");
var tradeFormatter_1 = require("./tradeFormatter");
var websocket_1 = require("./websocket");
function subscribeFeed(cb) {
    var _this = this;
    var ws = (0, websocket_1.getWebSocketClient)();
    var unsubWs = null;
    var seenIds = new Set();
    if (ws) {
        unsubWs = ws.subscribe("trade", function (data) {
            var trade = data;
            if (trade.id && !seenIds.has(trade.id)) {
                seenIds.add(trade.id);
                cb(trade);
            }
        });
    }
    var cancelled = false;
    var pollTimer = null;
    var polling = false;
    var hasLiveData = false;
    var poll = function (initial) { return __awaiter(_this, void 0, void 0, function () {
        var trades, uniqueTokens, rateEntries, rateMap, batchIds, _i, trades_2, t, _a, batchIds_1, id, _b, i;
        var _this = this;
        var _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (cancelled || polling)
                        return [2 /*return*/];
                    polling = true;
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 4, 5, 6]);
                    return [4 /*yield*/, (0, ponder_1.fetchPonderTrades)(undefined, 20)];
                case 2:
                    trades = _d.sent();
                    if (cancelled)
                        return [2 /*return*/];
                    uniqueTokens = __spreadArray([], new Set(trades.map(function (t) { return t.tokenAddress; })), true);
                    return [4 /*yield*/, Promise.all(uniqueTokens.map(function (addr) { return __awaiter(_this, void 0, void 0, function () { var _a; return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    _a = [addr];
                                    return [4 /*yield*/, (0, exchangeRates_1.resolveExchangeRate)(addr)];
                                case 1: return [2 /*return*/, _a.concat([_b.sent()])];
                            }
                        }); }); }))];
                case 3:
                    rateEntries = _d.sent();
                    rateMap = new Map(rateEntries);
                    batchIds = new Set();
                    for (_i = 0, trades_2 = trades; _i < trades_2.length; _i++) {
                        t = trades_2[_i];
                        batchIds.add(t.id);
                        if (seenIds.has(t.id))
                            continue;
                        cb((0, tradeFormatter_1.ponderTradeToTrade)(t, (_c = rateMap.get(t.tokenAddress)) !== null && _c !== void 0 ? _c : 1));
                    }
                    seenIds.clear();
                    for (_a = 0, batchIds_1 = batchIds; _a < batchIds_1.length; _a++) {
                        id = batchIds_1[_a];
                        seenIds.add(id);
                    }
                    hasLiveData = true;
                    return [3 /*break*/, 6];
                case 4:
                    _b = _d.sent();
                    if (!hasLiveData && initial && import.meta.env.DEV) {
                        for (i = 0; i < 8; i++) {
                            if (cancelled)
                                return [2 /*return*/];
                            cb((0, trades_1.generateFeedTrade)());
                        }
                    }
                    return [3 /*break*/, 6];
                case 5:
                    polling = false;
                    return [7 /*endfinally*/];
                case 6: return [2 /*return*/];
            }
        });
    }); };
    void poll(true);
    var schedulePoll = function () {
        if (cancelled)
            return;
        pollTimer = setTimeout(function () {
            void poll(false).finally(schedulePoll);
        }, (ws === null || ws === void 0 ? void 0 : ws.isConnected) ? 15000 : 3000);
    };
    schedulePoll();
    return function () {
        cancelled = true;
        if (pollTimer)
            clearTimeout(pollTimer);
        unsubWs === null || unsubWs === void 0 ? void 0 : unsubWs();
    };
}
function subscribeTokenTrades(address, cb) {
    var _this = this;
    var ws = (0, websocket_1.getWebSocketClient)();
    var unsubWs = null;
    var seenIds = new Set();
    var normalizedAddress = address.toLowerCase();
    if (ws) {
        unsubWs = ws.subscribe("trade", function (data) {
            var _a;
            var trade = data;
            if (trade.id && !seenIds.has(trade.id) && ((_a = trade.tokenAddress) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === normalizedAddress) {
                seenIds.add(trade.id);
                cb(trade);
            }
        }, normalizedAddress);
    }
    var cancelled = false;
    var polling = false;
    var hasLiveData = false;
    var poll = function () { return __awaiter(_this, void 0, void 0, function () {
        var _a, trades, exchangeRate, batchIds, _i, trades_3, t, _b, batchIds_2, id, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (cancelled || polling)
                        return [2 /*return*/];
                    polling = true;
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, Promise.all([
                            (0, ponder_1.fetchPonderTrades)(address, 30),
                            (0, exchangeRates_1.resolveExchangeRate)(address),
                        ])];
                case 2:
                    _a = _d.sent(), trades = _a[0], exchangeRate = _a[1];
                    if (cancelled)
                        return [2 /*return*/];
                    batchIds = new Set();
                    for (_i = 0, trades_3 = trades; _i < trades_3.length; _i++) {
                        t = trades_3[_i];
                        batchIds.add(t.id);
                        if (seenIds.has(t.id))
                            continue;
                        cb((0, tradeFormatter_1.ponderTradeToTrade)(t, exchangeRate));
                    }
                    seenIds.clear();
                    for (_b = 0, batchIds_2 = batchIds; _b < batchIds_2.length; _b++) {
                        id = batchIds_2[_b];
                        seenIds.add(id);
                    }
                    hasLiveData = true;
                    return [3 /*break*/, 5];
                case 3:
                    _c = _d.sent();
                    if (!hasLiveData && !cancelled && import.meta.env.DEV) {
                        cb((0, trades_1.generateTokenTrade)());
                    }
                    return [3 /*break*/, 5];
                case 4:
                    polling = false;
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    }); };
    void poll();
    var timer = null;
    var schedulePoll = function () {
        if (cancelled)
            return;
        timer = setTimeout(function () {
            void poll().finally(schedulePoll);
        }, (ws === null || ws === void 0 ? void 0 : ws.isConnected) ? 15000 : 5000);
    };
    schedulePoll();
    return function () {
        cancelled = true;
        if (timer)
            clearTimeout(timer);
        unsubWs === null || unsubWs === void 0 ? void 0 : unsubWs();
    };
}
