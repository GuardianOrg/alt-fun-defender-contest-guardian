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
exports.assetService = void 0;
var shared_1 = require("@launchpad/shared");
var api_1 = require("./api");
var ponder_1 = require("./ponder");
var colors_1 = require("../config/colors");
var TRACKED_ASSETS = ["HYPE", "ETH", "SOL", "BTC"];
function formatPrice(usd) {
    if (usd >= 10000)
        return "$".concat(Math.round(usd).toLocaleString());
    if (usd >= 100)
        return "$".concat(usd.toFixed(0));
    if (usd >= 1)
        return "$".concat(usd.toFixed(2));
    return "$".concat(usd.toFixed(4));
}
var cachedMids = null;
var cacheTime = 0;
var CACHE_TTL = 5000;
function fetchMids() {
    return __awaiter(this, void 0, void 0, function () {
        var res, data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (cachedMids && Date.now() - cacheTime < CACHE_TTL)
                        return [2 /*return*/, cachedMids];
                    return [4 /*yield*/, fetch(shared_1.HYPERLIQUID_INFO_API, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ type: "allMids" }),
                        })];
                case 1:
                    res = _a.sent();
                    return [4 /*yield*/, res.json()];
                case 2:
                    data = (_a.sent());
                    cachedMids = data;
                    cacheTime = Date.now();
                    return [2 /*return*/, data];
            }
        });
    });
}
var cached24hPrices = null;
var CHANGE_CACHE_TTL = 60000;
function fetch24hChanges(currentMids) {
    return __awaiter(this, void 0, void 0, function () {
        var now, dayAgo, changes, requests;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (cached24hPrices && Date.now() - cached24hPrices.ts < CHANGE_CACHE_TTL) {
                        return [2 /*return*/, cached24hPrices.data];
                    }
                    now = Date.now();
                    dayAgo = now - 24 * 60 * 60 * 1000;
                    changes = {};
                    requests = TRACKED_ASSETS.map(function (coin) { return __awaiter(_this, void 0, void 0, function () {
                        var res, candles, openPrice, currentPrice, _a;
                        var _b;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    _c.trys.push([0, 3, , 4]);
                                    return [4 /*yield*/, fetch(shared_1.HYPERLIQUID_INFO_API, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                type: "candleSnapshot",
                                                req: { coin: coin, interval: "1d", startTime: dayAgo, endTime: now },
                                            }),
                                        })];
                                case 1:
                                    res = _c.sent();
                                    return [4 /*yield*/, res.json()];
                                case 2:
                                    candles = (_c.sent());
                                    if (candles.length > 0) {
                                        openPrice = parseFloat(candles[0][1]);
                                        currentPrice = parseFloat((_b = currentMids[coin]) !== null && _b !== void 0 ? _b : "0");
                                        if (openPrice > 0) {
                                            changes[coin] = parseFloat((((currentPrice - openPrice) / openPrice) * 100).toFixed(2));
                                        }
                                    }
                                    return [3 /*break*/, 4];
                                case 3:
                                    _a = _c.sent();
                                    changes[coin] = 0;
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); });
                    return [4 /*yield*/, Promise.all(requests)];
                case 1:
                    _a.sent();
                    cached24hPrices = { data: changes, ts: now };
                    return [2 /*return*/, changes];
            }
        });
    });
}
var liveAssetService = {
    getAssets: function () {
        return __awaiter(this, void 0, void 0, function () {
            var mids_1, changes_1, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, fetchMids()];
                    case 1:
                        mids_1 = _b.sent();
                        return [4 /*yield*/, fetch24hChanges(mids_1)];
                    case 2:
                        changes_1 = _b.sent();
                        return [2 /*return*/, TRACKED_ASSETS.map(function (name) {
                                var _a, _b;
                                return ({
                                    name: name,
                                    priceUsd: formatPrice(parseFloat((_a = mids_1[name]) !== null && _a !== void 0 ? _a : "0")),
                                    change24h: (_b = changes_1[name]) !== null && _b !== void 0 ? _b : 0,
                                });
                            })];
                    case 3:
                        _a = _b.sent();
                        return [2 /*return*/, TRACKED_ASSETS.map(function (name) { return ({
                                name: name,
                                priceUsd: "—",
                                change24h: 0,
                            }); })];
                    case 4: return [2 /*return*/];
                }
            });
        });
    },
    getPlatformStats: function () {
        return __awaiter(this, void 0, void 0, function () {
            var res, json, stats, volume, _a, tokens, graduating, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 3, , 8]);
                        return [4 /*yield*/, fetch("".concat(api_1.API_BASE, "/api/v1/stats"))];
                    case 1:
                        res = _c.sent();
                        return [4 /*yield*/, res.json()];
                    case 2:
                        json = (_c.sent());
                        stats = json.data;
                        if (!stats)
                            throw new Error("No stats");
                        volume = Number(stats.volume24h) / 1e6;
                        return [2 /*return*/, {
                                tokensLive: stats.tokensLive,
                                graduating: 0,
                                volume24h: volume >= 1000 ? "$".concat((volume / 1000).toFixed(1), "K") : "$".concat(volume.toFixed(0)),
                                graduatedToday: 0,
                                totalRaised: "—",
                            }];
                    case 3:
                        _a = _c.sent();
                        _c.label = 4;
                    case 4:
                        _c.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, (0, ponder_1.fetchPonderTokens)(200)];
                    case 5:
                        tokens = _c.sent();
                        graduating = tokens.filter(function (t) { return !t.graduated; });
                        return [2 /*return*/, {
                                tokensLive: tokens.length,
                                graduating: graduating.length,
                                volume24h: "—",
                                graduatedToday: 0,
                                totalRaised: "—",
                            }];
                    case 6:
                        _b = _c.sent();
                        return [2 /*return*/, {
                                tokensLive: 0,
                                graduating: 0,
                                volume24h: "—",
                                graduatedToday: 0,
                                totalRaised: "—",
                            }];
                    case 7: return [3 /*break*/, 8];
                    case 8: return [2 /*return*/];
                }
            });
        });
    },
    getPairFilters: function () {
        return __awaiter(this, void 0, void 0, function () {
            var tokens, countMap, _i, tokens_1, t, dir, existing, _a;
            var _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, (0, api_1.fetchTokens)(200)];
                    case 1:
                        tokens = _d.sent();
                        countMap = new Map();
                        for (_i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
                            t = tokens_1[_i];
                            dir = t.ltDirection === "short" ? "short" : "long";
                            existing = (_b = countMap.get(dir)) !== null && _b !== void 0 ? _b : 0;
                            countMap.set(dir, existing + 1);
                        }
                        return [2 /*return*/, [
                                {
                                    asset: "HYPE",
                                    direction: "long",
                                    count: (_c = countMap.get("long")) !== null && _c !== void 0 ? _c : 0,
                                    color: colors_1.COLORS.mint,
                                },
                            ]];
                    case 2:
                        _a = _d.sent();
                        return [2 /*return*/, [
                                {
                                    asset: "HYPE",
                                    direction: "long",
                                    count: 0,
                                    color: colors_1.COLORS.mint,
                                },
                            ]];
                    case 3: return [2 /*return*/];
                }
            });
        });
    },
};
exports.assetService = liveAssetService;
