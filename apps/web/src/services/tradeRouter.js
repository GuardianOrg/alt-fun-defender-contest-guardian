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
exports.tradeRouterService = void 0;
var shared_1 = require("@launchpad/shared");
var viem_1 = require("viem");
var constants_1 = require("../config/constants");
var addresses_1 = require("../contracts/addresses");
var HYPER_EVM_RPC = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
var publicClient = (0, viem_1.createPublicClient)({
    transport: (0, viem_1.http)(HYPER_EVM_RPC),
});
function getTokenPair(tokenAddress) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, pairAddress, ltAddress;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, Promise.all([
                        publicClient.readContract({
                            address: addresses_1.ADDRESSES.factory,
                            abi: shared_1.FFactoryAbi,
                            functionName: "pairFor",
                            args: [tokenAddress],
                        }),
                        publicClient.readContract({
                            address: addresses_1.ADDRESSES.factory,
                            abi: shared_1.FFactoryAbi,
                            functionName: "ltFor",
                            args: [tokenAddress],
                        }),
                    ])];
                case 1:
                    _a = _b.sent(), pairAddress = _a[0], ltAddress = _a[1];
                    return [2 /*return*/, { pairAddress: pairAddress, ltAddress: ltAddress }];
            }
        });
    });
}
var FPairAbi = [
    {
        name: "getReserves",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [
            { name: "reserve0", type: "uint256" },
            { name: "reserve1", type: "uint256" },
        ],
    },
];
var liveTradeRouter = {
    getQuoteBuy: function (curveAddress, usdcAmount) {
        return __awaiter(this, void 0, void 0, function () {
            var tokenAddr, _a, pairAddress, ltAddress, _b, reserves, exchangeRate, tokenReserve, ltReserve, exRate, ltReserveFloat, tokenReserveFloat, curveFee, netUsdc, ltIn, tokensOut, priceImpact, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 3, , 4]);
                        tokenAddr = curveAddress;
                        return [4 /*yield*/, getTokenPair(tokenAddr)];
                    case 1:
                        _a = _d.sent(), pairAddress = _a.pairAddress, ltAddress = _a.ltAddress;
                        return [4 /*yield*/, Promise.all([
                                publicClient.readContract({
                                    address: pairAddress,
                                    abi: FPairAbi,
                                    functionName: "getReserves",
                                }),
                                publicClient.readContract({
                                    address: ltAddress,
                                    abi: shared_1.LeveragedTokenAbi,
                                    functionName: "exchangeRate",
                                }),
                            ])];
                    case 2:
                        _b = _d.sent(), reserves = _b[0], exchangeRate = _b[1];
                        tokenReserve = reserves[0], ltReserve = reserves[1];
                        exRate = parseFloat((0, viem_1.formatUnits)(exchangeRate, 18));
                        ltReserveFloat = parseFloat((0, viem_1.formatUnits)(ltReserve, 18));
                        tokenReserveFloat = parseFloat((0, viem_1.formatUnits)(tokenReserve, 18));
                        curveFee = usdcAmount * constants_1.FEES.curveBuy;
                        netUsdc = usdcAmount - curveFee;
                        ltIn = netUsdc / exRate;
                        tokensOut = (tokenReserveFloat * ltIn) / (ltReserveFloat + ltIn);
                        priceImpact = ltReserveFloat > 0 ? (ltIn / ltReserveFloat) * 100 : 0;
                        return [2 /*return*/, {
                                tokensOut: tokensOut.toLocaleString(undefined, {
                                    maximumFractionDigits: 0,
                                }),
                                curveFee: curveFee,
                                totalFee: curveFee,
                                priceImpactPct: parseFloat(priceImpact.toFixed(2)),
                                youPay: usdcAmount,
                                youReceive: "".concat((tokensOut / 1e6).toFixed(1), "M"),
                            }];
                    case 3:
                        _c = _d.sent();
                        return [2 /*return*/, mockBuyQuote(usdcAmount)];
                    case 4: return [2 /*return*/];
                }
            });
        });
    },
    getQuoteSell: function (curveAddress, tokenAmount) {
        return __awaiter(this, void 0, void 0, function () {
            var tokenAddr, _a, pairAddress, ltAddress, _b, reserves, exchangeRate, baseAssetBal, tokenReserve, ltReserve, exRate, ltReserveFloat, tokenReserveFloat, bufferUsdc, ltOut, grossUsdc, curveFee, ltRedemptionFee, totalFee, netUsdc, priceImpact, bufferLt, bufferBinds, maxSellableTokens, safeMaxSellable, redeemUsdc, exceedsBuffer, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 3, , 4]);
                        tokenAddr = curveAddress;
                        return [4 /*yield*/, getTokenPair(tokenAddr)];
                    case 1:
                        _a = _d.sent(), pairAddress = _a.pairAddress, ltAddress = _a.ltAddress;
                        return [4 /*yield*/, Promise.all([
                                publicClient.readContract({
                                    address: pairAddress,
                                    abi: FPairAbi,
                                    functionName: "getReserves",
                                }),
                                publicClient.readContract({
                                    address: ltAddress,
                                    abi: shared_1.LeveragedTokenAbi,
                                    functionName: "exchangeRate",
                                }),
                                publicClient.readContract({
                                    address: ltAddress,
                                    abi: shared_1.LeveragedTokenAbi,
                                    functionName: "baseAssetBalance",
                                }),
                            ])];
                    case 2:
                        _b = _d.sent(), reserves = _b[0], exchangeRate = _b[1], baseAssetBal = _b[2];
                        tokenReserve = reserves[0], ltReserve = reserves[1];
                        exRate = parseFloat((0, viem_1.formatUnits)(exchangeRate, 18));
                        ltReserveFloat = parseFloat((0, viem_1.formatUnits)(ltReserve, 18));
                        tokenReserveFloat = parseFloat((0, viem_1.formatUnits)(tokenReserve, 18));
                        bufferUsdc = parseFloat((0, viem_1.formatUnits)(baseAssetBal, 6));
                        ltOut = (ltReserveFloat * tokenAmount) / (tokenReserveFloat + tokenAmount);
                        grossUsdc = ltOut * exRate;
                        curveFee = grossUsdc * constants_1.FEES.curveSell;
                        ltRedemptionFee = grossUsdc * constants_1.FEES.ltRedemption * 2;
                        totalFee = curveFee + ltRedemptionFee;
                        netUsdc = grossUsdc - totalFee;
                        priceImpact = tokenReserveFloat > 0
                            ? (tokenAmount / tokenReserveFloat) * 100
                            : 0;
                        bufferLt = exRate > 0 ? bufferUsdc / exRate : 0;
                        bufferBinds = bufferLt > 0 && ltReserveFloat > bufferLt;
                        maxSellableTokens = bufferBinds
                            ? (tokenReserveFloat * bufferLt) / (ltReserveFloat - bufferLt)
                            : Infinity;
                        safeMaxSellable = Number.isFinite(maxSellableTokens)
                            ? Math.max(0, maxSellableTokens)
                            : Infinity;
                        redeemUsdc = grossUsdc - curveFee;
                        exceedsBuffer = redeemUsdc > bufferUsdc;
                        return [2 /*return*/, {
                                usdcOut: netUsdc,
                                curveFee: curveFee,
                                ltRedemptionFee: ltRedemptionFee,
                                totalFee: totalFee,
                                priceImpactPct: parseFloat(priceImpact.toFixed(2)),
                                youReceive: netUsdc,
                                maxSellableTokens: safeMaxSellable,
                                bufferUsdc: bufferUsdc,
                                exceedsBuffer: exceedsBuffer,
                            }];
                    case 3:
                        _c = _d.sent();
                        return [2 /*return*/, null];
                    case 4: return [2 /*return*/];
                }
            });
        });
    },
};
function mockBuyQuote(usdcAmount) {
    var curveFee = usdcAmount * constants_1.FEES.curveBuy;
    var netUsdc = usdcAmount - curveFee;
    var tokensOut = netUsdc / constants_1.MOCK_TOKEN_PRICE;
    var mockMcap = constants_1.MOCK_TOKEN_PRICE * 1e9;
    var priceImpact = (usdcAmount / mockMcap) * 100;
    return {
        tokensOut: tokensOut.toLocaleString(undefined, {
            maximumFractionDigits: 0,
        }),
        curveFee: curveFee,
        totalFee: curveFee,
        priceImpactPct: parseFloat(priceImpact.toFixed(2)),
        youPay: usdcAmount,
        youReceive: "".concat((tokensOut / 1e6).toFixed(1), "M"),
    };
}
exports.tradeRouterService = liveTradeRouter;
