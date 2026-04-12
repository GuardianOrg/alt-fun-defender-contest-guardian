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
exports.tradeService = void 0;
var viem_1 = require("viem");
var api_1 = require("./api");
var trades_1 = require("./mock/trades");
var ponder_1 = require("./ponder");
var websocket_1 = require("./websocket");
var format_1 = require("../utils/format");
var TOKEN_DECIMALS = Math.pow(10n, 18n);
function formatTenths(value, divisor, suffix) {
    var tenths = (value * 10n + divisor / 2n) / divisor;
    return "".concat(tenths / 10n, ".").concat(tenths % 10n).concat(suffix);
}
function formatTokenBalance(raw) {
    var amount = BigInt(raw);
    if (amount >= 1000000000n * TOKEN_DECIMALS)
        return formatTenths(amount, 1000000000n * TOKEN_DECIMALS, "B");
    if (amount >= 1000000n * TOKEN_DECIMALS)
        return formatTenths(amount, 1000000n * TOKEN_DECIMALS, "M");
    if (amount >= 1000n * TOKEN_DECIMALS)
        return formatTenths(amount, 1000n * TOKEN_DECIMALS, "K");
    return formatTenths(amount, TOKEN_DECIMALS, "");
}
// LT address → exchange rate (USD per LT, as a float)
var ltRateCache = new Map();
var ltRateCacheTime = 0;
var LT_RATE_CACHE_TTL = 60000;
function getLtExchangeRates() {
    return __awaiter(this, void 0, void 0, function () {
        var lts, rates, _i, lts_1, lt;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (Date.now() - ltRateCacheTime < LT_RATE_CACHE_TTL && ltRateCache.size > 0) {
                        return [2 /*return*/, ltRateCache];
                    }
                    return [4 /*yield*/, (0, api_1.fetchLeveragedTokens)()];
                case 1:
                    lts = _a.sent();
                    rates = new Map();
                    for (_i = 0, lts_1 = lts; _i < lts_1.length; _i++) {
                        lt = lts_1[_i];
                        rates.set(lt.address.toLowerCase(), parseFloat((0, viem_1.formatUnits)(BigInt(lt.exchangeRate), 18)));
                    }
                    ltRateCache = rates;
                    ltRateCacheTime = Date.now();
                    return [2 /*return*/, rates];
            }
        });
    });
}
// tokenAddress → ltAddress (lowercase)
var tokenLtMap = new Map();
function getLtAddressForToken(tokenAddress) {
    return __awaiter(this, void 0, void 0, function () {
        var key, cached, token, ltAddr;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    key = tokenAddress.toLowerCase();
                    cached = tokenLtMap.get(key);
                    if (cached)
                        return [2 /*return*/, cached];
                    return [4 /*yield*/, (0, ponder_1.fetchPonderToken)(tokenAddress)];
                case 1:
                    token = _a.sent();
                    if (token) {
                        ltAddr = token.ltToken.toLowerCase();
                        tokenLtMap.set(key, ltAddr);
                        return [2 /*return*/, ltAddr];
                    }
                    return [2 /*return*/, undefined];
            }
        });
    });
}
function resolveExchangeRate(tokenAddress) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, rates, ltAddr;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, Promise.all([
                        getLtExchangeRates(),
                        getLtAddressForToken(tokenAddress),
                    ])];
                case 1:
                    _a = _c.sent(), rates = _a[0], ltAddr = _a[1];
                    if (ltAddr) {
                        return [2 /*return*/, (_b = rates.get(ltAddr)) !== null && _b !== void 0 ? _b : 1];
                    }
                    return [2 /*return*/, 1];
            }
        });
    });
}
function ponderTradeToTrade(pt, exchangeRate) {
    var ltAmountFloat = parseFloat((0, viem_1.formatUnits)(BigInt(pt.ltAmount), 18));
    return {
        id: pt.id,
        side: pt.isBuy ? "BUY" : "SELL",
        amountUsd: ltAmountFloat * exchangeRate,
        tokensAmount: (0, viem_1.formatUnits)(BigInt(pt.tokenAmount), 18),
        walletAddress: "".concat(pt.trader.slice(0, 4), "\u2026").concat(pt.trader.slice(-2)),
        timestamp: new Date(Number(pt.timestamp) * 1000).toISOString(),
        tokenAddress: pt.tokenAddress,
        tokenName: "",
    };
}
var liveTradeService = {
    subscribeFeed: function (cb) {
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
                                        return [4 /*yield*/, resolveExchangeRate(addr)];
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
                            cb(ponderTradeToTrade(t, (_c = rateMap.get(t.tokenAddress)) !== null && _c !== void 0 ? _c : 1));
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
    },
    subscribeTokenTrades: function (address, cb) {
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
                                resolveExchangeRate(address),
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
                            cb(ponderTradeToTrade(t, exchangeRate));
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
    },
    getInitialTrades: function (address) {
        void address;
        if (import.meta.env.DEV) {
            return __spreadArray([], trades_1.INITIAL_TOKEN_TRADES, true);
        }
        return [];
    },
    getComments: function (address) {
        return __awaiter(this, void 0, void 0, function () {
            var apiComments, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, (0, api_1.fetchComments)(address)];
                    case 1:
                        apiComments = _b.sent();
                        return [2 /*return*/, apiComments.map(function (c) { return ({
                                id: String(c.id),
                                emoji: "",
                                address: "".concat(c.author.slice(0, 4), "\u2026").concat(c.author.slice(-2)),
                                timeAgo: (0, format_1.formatTimeAgo)(c.createdAt),
                                text: c.content,
                            }); })];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, []];
                    case 3: return [2 /*return*/];
                }
            });
        });
    },
    getHolders: function (address) {
        return __awaiter(this, void 0, void 0, function () {
            var holders, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, (0, api_1.fetchHolders)(address)];
                    case 1:
                        holders = (_b.sent()).holders;
                        return [2 /*return*/, holders.map(function (h, i) { return ({
                                rank: i + 1,
                                address: "".concat(h.wallet.slice(0, 4), "\u2026").concat(h.wallet.slice(-2)),
                                tokens: formatTokenBalance(h.balance),
                                percentSupply: h.percentage,
                                isCreator: false,
                            }); })];
                    case 2:
                        _a = _b.sent();
                        if (import.meta.env.DEV) {
                            return [2 /*return*/, __spreadArray([], trades_1.MOCK_HOLDERS, true)];
                        }
                        return [2 /*return*/, []];
                    case 3: return [2 /*return*/];
                }
            });
        });
    },
};
exports.tradeService = liveTradeService;
