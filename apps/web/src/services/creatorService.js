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
exports.creatorService = void 0;
var shared_1 = require("@launchpad/shared");
var viem_1 = require("viem");
var api_1 = require("./api");
var abis_1 = require("../contracts/abis");
var addresses_1 = require("../contracts/addresses");
var HYPER_EVM_RPC = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
var publicClient = (0, viem_1.createPublicClient)({
    transport: (0, viem_1.http)(HYPER_EVM_RPC),
});
var liveCreatorService = {
    getBalances: function (walletAddress) {
        return __awaiter(this, void 0, void 0, function () {
            var tokens, balances, _i, tokens_1, token, balance, _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 8, , 9]);
                        return [4 /*yield*/, (0, api_1.fetchTokens)(100)];
                    case 1:
                        tokens = _c.sent();
                        balances = [];
                        _i = 0, tokens_1 = tokens;
                        _c.label = 2;
                    case 2:
                        if (!(_i < tokens_1.length)) return [3 /*break*/, 7];
                        token = tokens_1[_i];
                        _c.label = 3;
                    case 3:
                        _c.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, publicClient.readContract({
                                address: token.address,
                                abi: abis_1.erc20Abi,
                                functionName: "balanceOf",
                                args: [walletAddress],
                            })];
                    case 4:
                        balance = (_c.sent());
                        if (balance > 0n) {
                            balances.push({
                                address: token.address,
                                name: token.name,
                                ticker: token.ticker,
                                emoji: "",
                                ltName: "".concat(token.ltPair, " ").concat(token.leverage, "\u00D7"),
                                status: "active",
                                amount: parseFloat((0, viem_1.formatUnits)(balance, 18)),
                                valueUsd: 0,
                                change24h: 0,
                            });
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        _a = _c.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        _i++;
                        return [3 /*break*/, 2];
                    case 7: return [2 /*return*/, balances];
                    case 8:
                        _b = _c.sent();
                        return [2 /*return*/, []];
                    case 9: return [2 /*return*/];
                }
            });
        });
    },
    getEarnings: function (walletAddress) {
        return __awaiter(this, void 0, void 0, function () {
            var tokens, createdTokens, totalClaimable, tokenEarnings, _i, createdTokens_1, token, info, ltAddress, claimable, claimableUsd, _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 9, , 10]);
                        return [4 /*yield*/, (0, api_1.fetchTokens)(100)];
                    case 1:
                        tokens = _c.sent();
                        createdTokens = tokens.filter(function (t) { return t.creator.toLowerCase() === walletAddress.toLowerCase(); });
                        if (createdTokens.length === 0)
                            return [2 /*return*/, null];
                        totalClaimable = 0;
                        tokenEarnings = [];
                        _i = 0, createdTokens_1 = createdTokens;
                        _c.label = 2;
                    case 2:
                        if (!(_i < createdTokens_1.length)) return [3 /*break*/, 8];
                        token = createdTokens_1[_i];
                        _c.label = 3;
                    case 3:
                        _c.trys.push([3, 6, , 7]);
                        return [4 /*yield*/, publicClient.readContract({
                                address: addresses_1.ADDRESSES.bonding,
                                abi: shared_1.BondingAbi,
                                functionName: "tokenInfo",
                                args: [token.address],
                            })];
                    case 4:
                        info = (_c.sent());
                        ltAddress = info[3];
                        return [4 /*yield*/, publicClient.readContract({
                                address: addresses_1.ADDRESSES.bonding,
                                abi: shared_1.BondingAbi,
                                functionName: "creatorFees",
                                args: [walletAddress, ltAddress],
                            })];
                    case 5:
                        claimable = (_c.sent());
                        claimableUsd = parseFloat((0, viem_1.formatUnits)(claimable, 18));
                        totalClaimable += claimableUsd;
                        tokenEarnings.push({
                            address: token.address,
                            name: token.name,
                            emoji: "",
                            ltName: "".concat(token.ltPair, " ").concat(token.leverage, "\u00D7"),
                            status: "active",
                            curveFilled: 0,
                            totalVolumeUsd: 0,
                            feesEarnedUsd: claimableUsd,
                            feesClaimableUsd: claimableUsd,
                        });
                        return [3 /*break*/, 7];
                    case 6:
                        _a = _c.sent();
                        tokenEarnings.push({
                            address: token.address,
                            name: token.name,
                            emoji: "",
                            ltName: "".concat(token.ltPair, " ").concat(token.leverage, "\u00D7"),
                            status: "active",
                            curveFilled: 0,
                            totalVolumeUsd: 0,
                            feesEarnedUsd: 0,
                            feesClaimableUsd: 0,
                        });
                        return [3 /*break*/, 7];
                    case 7:
                        _i++;
                        return [3 /*break*/, 2];
                    case 8: return [2 /*return*/, {
                            totalEarned: totalClaimable,
                            totalClaimable: totalClaimable,
                            totalClaimed: 0,
                            tokens: tokenEarnings,
                        }];
                    case 9:
                        _b = _c.sent();
                        return [2 /*return*/, null];
                    case 10: return [2 /*return*/];
                }
            });
        });
    },
    claimEarnings: function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                throw new Error("Use useCreatorEarnings hook for on-chain claims");
            });
        });
    },
};
exports.creatorService = liveCreatorService;
