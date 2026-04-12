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
exports.tradeService = exports.subscribeTokenTrades = exports.subscribeFeed = exports.ponderTradeToTrade = exports.formatTokenBalance = exports.resolveExchangeRate = exports.getLtExchangeRates = void 0;
var api_1 = require("./api");
var trades_1 = require("./mock/trades");
var tradeFeed_1 = require("./tradeFeed");
var tradeFormatter_1 = require("./tradeFormatter");
var format_1 = require("../utils/format");
var exchangeRates_1 = require("./exchangeRates");
Object.defineProperty(exports, "getLtExchangeRates", { enumerable: true, get: function () { return exchangeRates_1.getLtExchangeRates; } });
Object.defineProperty(exports, "resolveExchangeRate", { enumerable: true, get: function () { return exchangeRates_1.resolveExchangeRate; } });
var tradeFormatter_2 = require("./tradeFormatter");
Object.defineProperty(exports, "formatTokenBalance", { enumerable: true, get: function () { return tradeFormatter_2.formatTokenBalance; } });
Object.defineProperty(exports, "ponderTradeToTrade", { enumerable: true, get: function () { return tradeFormatter_2.ponderTradeToTrade; } });
var tradeFeed_2 = require("./tradeFeed");
Object.defineProperty(exports, "subscribeFeed", { enumerable: true, get: function () { return tradeFeed_2.subscribeFeed; } });
Object.defineProperty(exports, "subscribeTokenTrades", { enumerable: true, get: function () { return tradeFeed_2.subscribeTokenTrades; } });
var liveTradeService = {
    subscribeFeed: tradeFeed_1.subscribeFeed,
    subscribeTokenTrades: tradeFeed_1.subscribeTokenTrades,
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
                                tokens: (0, tradeFormatter_1.formatTokenBalance)(h.balance),
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
