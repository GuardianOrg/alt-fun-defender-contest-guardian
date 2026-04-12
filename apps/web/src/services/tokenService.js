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
exports.tokenService = void 0;
exports.ltDisplayName = ltDisplayName;
exports.deriveUnderlying = deriveUnderlying;
exports.deriveDirection = deriveDirection;
exports.deriveStatus = deriveStatus;
var api_1 = require("./api");
var tokens_1 = require("./mock/tokens");
var ponder_1 = require("./ponder");
function ltDisplayName(apiToken) {
    var dir = apiToken.ltDirection === "long" ? "Long" : "Short";
    return "".concat(apiToken.ltPair.replace(/\d+[LS]$/, ""), " ").concat(apiToken.leverage, "\u00D7 ").concat(dir);
}
function deriveUnderlying(apiToken) {
    if (apiToken.underlying && apiToken.underlying !== "") {
        return apiToken.underlying;
    }
    var match = apiToken.ltPair.match(/^(HYPE|ETH|BTC|SOL|ARB|OP)/i);
    return (match ? match[1].toUpperCase() : "HYPE");
}
function deriveDirection(apiToken) {
    return apiToken.ltDirection === "short" ? "short" : "long";
}
function deriveStatus(apiToken) {
    if (apiToken.status === "graduated")
        return "graduated";
    if (apiToken.status === "graduating")
        return "graduating";
    return "active";
}
function mergeToken(api, onchain) {
    var _a;
    var totalSupply = 1000000000n * Math.pow(10n, 18n);
    var curveAlloc = (totalSupply * 75n) / 100n;
    var curveSupply = onchain ? BigInt(onchain.curveSupply) : 0n;
    var soldTokens = curveAlloc - curveSupply;
    var curveFilled = curveAlloc > 0n ? Number((soldTokens * 10000n) / curveAlloc) / 100 : 0;
    var isGraduated = (_a = onchain === null || onchain === void 0 ? void 0 : onchain.graduated) !== null && _a !== void 0 ? _a : false;
    var status = isGraduated
        ? "graduated"
        : curveFilled >= 90
            ? "graduating"
            : "active";
    return {
        address: api.address,
        name: api.name,
        ticker: api.ticker,
        emoji: "",
        image: api.imageUrl ? new URL(api.imageUrl, api_1.API_BASE).toString() : undefined,
        description: api.description,
        direction: deriveDirection(api),
        underlying: deriveUnderlying(api),
        leverage: api.leverage,
        ltName: ltDisplayName(api),
        mcapUsd: 0,
        change24h: 0,
        buyMomentum: 0,
        leverageBoost: 0,
        curveFilled: Math.min(curveFilled, 100),
        curveRaisedUsd: 0,
        volume24h: 0,
        athUsd: 0,
        status: status,
        creatorAddress: api.creator,
        createdAt: api.createdAt,
        socialLinks: (api.twitterUrl || api.telegramUrl || api.websiteUrl) ? {
            twitter: api.twitterUrl || undefined,
            telegram: api.telegramUrl || undefined,
            website: api.websiteUrl || undefined,
        } : undefined,
    };
}
function applyFilter(tokens, filter) {
    switch (filter) {
        case "graduating":
            return tokens.filter(function (t) { return t.status === "graduating"; });
        case "graduated":
            return tokens.filter(function (t) { return t.status === "graduated"; });
        case "new":
            return __spreadArray([], tokens, true).sort(function (a, b) {
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
        case "lt-movers":
            return tokens
                .filter(function (t) { return t.leverageBoost > 0; })
                .sort(function (a, b) { return b.leverageBoost - a.leverageBoost; });
        case "all":
            return tokens;
        case "trending":
        default: {
            var graduated = tokens.filter(function (t) { return t.status === "graduated"; });
            var active = tokens.filter(function (t) { return t.status !== "graduated"; });
            active.sort(function (a, b) { return b.mcapUsd - a.mcapUsd; });
            var king = graduated.sort(function (a, b) { return b.mcapUsd - a.mcapUsd; })[0];
            return king ? __spreadArray([king], active, true) : active;
        }
    }
}
function liveGetTokens(filter) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, apiTokens, ponderTokens, ponderMap, merged;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, Promise.all([
                        (0, api_1.fetchTokens)(100).catch(function () { return []; }),
                        (0, ponder_1.fetchPonderTokens)(100).catch(function () { return []; }),
                    ])];
                case 1:
                    _a = _b.sent(), apiTokens = _a[0], ponderTokens = _a[1];
                    if (apiTokens.length === 0 && ponderTokens.length === 0) {
                        if (import.meta.env.DEV) {
                            return [2 /*return*/, applyFilter(tokens_1.MOCK_TOKENS, filter)];
                        }
                        return [2 /*return*/, []];
                    }
                    ponderMap = new Map(ponderTokens.map(function (t) { return [t.address.toLowerCase(), t]; }));
                    merged = apiTokens.map(function (api) { var _a; return mergeToken(api, (_a = ponderMap.get(api.address.toLowerCase())) !== null && _a !== void 0 ? _a : null); });
                    return [2 /*return*/, applyFilter(merged, filter)];
            }
        });
    });
}
function liveGetToken(address) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, apiToken, ponderToken;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, Promise.all([
                        (0, api_1.fetchToken)(address).catch(function () { return null; }),
                        (0, ponder_1.fetchPonderToken)(address).catch(function () { return null; }),
                    ])];
                case 1:
                    _a = _b.sent(), apiToken = _a[0], ponderToken = _a[1];
                    if (!apiToken) {
                        if (import.meta.env.DEV) {
                            return [2 /*return*/, tokens_1.MOCK_TOKENS.find(function (t) { return t.address === address; })];
                        }
                        return [2 /*return*/, undefined];
                    }
                    return [2 /*return*/, mergeToken(apiToken, ponderToken)];
            }
        });
    });
}
function liveGetTokensByDirection(direction, filter) {
    return __awaiter(this, void 0, void 0, function () {
        var tokens;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, liveGetTokens(filter)];
                case 1:
                    tokens = _a.sent();
                    return [2 /*return*/, tokens.filter(function (t) { return t.direction === direction; })];
            }
        });
    });
}
var liveTokenService = {
    getTokens: liveGetTokens,
    getToken: liveGetToken,
    getTokensByDirection: liveGetTokensByDirection,
};
exports.tokenService = liveTokenService;
