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
            var tokens, balanceCalls, results, balances, i, result, balance, token, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, (0, api_1.fetchTokens)(100)];
                    case 1:
                        tokens = _b.sent();
                        if (tokens.length === 0)
                            return [2 /*return*/, []];
                        balanceCalls = tokens.map(function (token) { return ({
                            address: token.address,
                            abi: abis_1.erc20Abi,
                            functionName: "balanceOf",
                            args: [walletAddress],
                        }); });
                        return [4 /*yield*/, publicClient.multicall({
                                contracts: balanceCalls,
                                allowFailure: true,
                            })];
                    case 2:
                        results = _b.sent();
                        balances = [];
                        for (i = 0; i < tokens.length; i++) {
                            result = results[i];
                            if (result.status === "success") {
                                balance = result.result;
                                if (balance > 0n) {
                                    token = tokens[i];
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
                            }
                        }
                        return [2 /*return*/, balances];
                    case 3:
                        _a = _b.sent();
                        return [2 /*return*/, []];
                    case 4: return [2 /*return*/];
                }
            });
        });
    },
    getEarnings: function (walletAddress) {
        return __awaiter(this, void 0, void 0, function () {
            var tokens, createdTokens_1, tokenInfoCalls, tokenInfoResults_1, creatorFeeCalls, feeResults_1, totalClaimable_1, tokenEarnings, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 4, , 5]);
                        return [4 /*yield*/, (0, api_1.fetchTokens)(100)];
                    case 1:
                        tokens = _b.sent();
                        createdTokens_1 = tokens.filter(function (t) { return t.creator.toLowerCase() === walletAddress.toLowerCase(); });
                        if (createdTokens_1.length === 0)
                            return [2 /*return*/, null];
                        tokenInfoCalls = createdTokens_1.map(function (token) { return ({
                            address: addresses_1.ADDRESSES.bonding,
                            abi: shared_1.BondingAbi,
                            functionName: "tokenInfo",
                            args: [token.address],
                        }); });
                        return [4 /*yield*/, publicClient.multicall({
                                contracts: tokenInfoCalls,
                                allowFailure: true,
                            })];
                    case 2:
                        tokenInfoResults_1 = _b.sent();
                        creatorFeeCalls = tokenInfoResults_1.map(function (infoResult, i) {
                            if (infoResult.status === "success") {
                                var info = infoResult.result;
                                var ltAddress = info[3];
                                return {
                                    address: addresses_1.ADDRESSES.bonding,
                                    abi: shared_1.BondingAbi,
                                    functionName: "creatorFees",
                                    args: [walletAddress, ltAddress],
                                };
                            }
                            // Placeholder call for failed tokenInfo — will also fail, handled below
                            return {
                                address: addresses_1.ADDRESSES.bonding,
                                abi: shared_1.BondingAbi,
                                functionName: "creatorFees",
                                args: [walletAddress, createdTokens_1[i].address],
                            };
                        });
                        return [4 /*yield*/, publicClient.multicall({
                                contracts: creatorFeeCalls,
                                allowFailure: true,
                            })];
                    case 3:
                        feeResults_1 = _b.sent();
                        totalClaimable_1 = 0;
                        tokenEarnings = createdTokens_1.map(function (token, i) {
                            var feeResult = feeResults_1[i];
                            if (tokenInfoResults_1[i].status === "success" && feeResult.status === "success") {
                                var claimable = feeResult.result;
                                var claimableUsd = parseFloat((0, viem_1.formatUnits)(claimable, 18));
                                totalClaimable_1 += claimableUsd;
                                return {
                                    address: token.address,
                                    name: token.name,
                                    emoji: "",
                                    ltName: "".concat(token.ltPair, " ").concat(token.leverage, "\u00D7"),
                                    status: "active",
                                    curveFilled: 0,
                                    totalVolumeUsd: 0,
                                    feesEarnedUsd: claimableUsd,
                                    feesClaimableUsd: claimableUsd,
                                };
                            }
                            return {
                                address: token.address,
                                name: token.name,
                                emoji: "",
                                ltName: "".concat(token.ltPair, " ").concat(token.leverage, "\u00D7"),
                                status: "active",
                                curveFilled: 0,
                                totalVolumeUsd: 0,
                                feesEarnedUsd: 0,
                                feesClaimableUsd: 0,
                            };
                        });
                        return [2 /*return*/, {
                                totalEarned: totalClaimable_1,
                                totalClaimable: totalClaimable_1,
                                totalClaimed: 0,
                                tokens: tokenEarnings,
                            }];
                    case 4:
                        _a = _b.sent();
                        return [2 /*return*/, null];
                    case 5: return [2 /*return*/];
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
