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
exports.useTradeRouter = useTradeRouter;
var react_1 = require("react");
var viem_1 = require("viem");
var wagmi_1 = require("wagmi");
var abis_1 = require("../contracts/abis");
var addresses_1 = require("../contracts/addresses");
var format_1 = require("../utils/format");
function slippageToBps(slippage) {
    var clamped = Number.isFinite(slippage) ? Math.max(slippage, 0) : 0;
    return Math.min(Math.floor(clamped * 100), 10000);
}
function useTradeRouter() {
    var _this = this;
    var _a = (0, wagmi_1.useAccount)(), address = _a.address, isConnected = _a.isConnected;
    var publicClient = (0, wagmi_1.usePublicClient)();
    var walletClient = (0, wagmi_1.useWalletClient)().data;
    var _b = (0, react_1.useState)("idle"), step = _b[0], setStep = _b[1];
    var _c = (0, react_1.useState)(null), txHash = _c[0], setTxHash = _c[1];
    var _d = (0, react_1.useState)(null), error = _d[0], setError = _d[1];
    var executeBuy = (0, react_1.useCallback)(function (tokenAddress, usdcAmount, slippage, referrer) { return __awaiter(_this, void 0, void 0, function () {
        var usdcAmountWei, routerAddr, allowance, approveTx, deadline, ZERO_ADDR, referrerAddr, slippageBps, quotedTokensOut, minTokensOut, buyTx, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!isConnected || !address || !walletClient || !publicClient) {
                        setError("Connect wallet first");
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 9, , 10]);
                    setError(null);
                    setStep("approving");
                    usdcAmountWei = (0, viem_1.parseUnits)(usdcAmount.toString(), addresses_1.USDC_DECIMALS);
                    routerAddr = addresses_1.ADDRESSES.redemptionRouter;
                    return [4 /*yield*/, publicClient.readContract({
                            address: addresses_1.ADDRESSES.usdc,
                            abi: abis_1.erc20Abi,
                            functionName: "allowance",
                            args: [address, routerAddr],
                        })];
                case 2:
                    allowance = _a.sent();
                    if (!(allowance < usdcAmountWei)) return [3 /*break*/, 5];
                    return [4 /*yield*/, walletClient.writeContract({
                            address: addresses_1.ADDRESSES.usdc,
                            abi: abis_1.erc20Abi,
                            functionName: "approve",
                            args: [routerAddr, viem_1.maxUint256],
                        })];
                case 3:
                    approveTx = _a.sent();
                    return [4 /*yield*/, publicClient.waitForTransactionReceipt({ hash: approveTx })];
                case 4:
                    _a.sent();
                    _a.label = 5;
                case 5:
                    setStep("executing");
                    deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
                    ZERO_ADDR = "0x0000000000000000000000000000000000000000";
                    referrerAddr = referrer && (0, viem_1.isAddress)(referrer) ? referrer : ZERO_ADDR;
                    slippageBps = slippageToBps(slippage);
                    return [4 /*yield*/, publicClient.simulateContract({
                            address: routerAddr,
                            abi: abis_1.RedemptionRouterAbi,
                            functionName: "buy",
                            args: [
                                tokenAddress,
                                usdcAmountWei,
                                0n,
                                deadline,
                                referrerAddr,
                            ],
                            account: address,
                        })];
                case 6:
                    quotedTokensOut = (_a.sent()).result;
                    minTokensOut = (quotedTokensOut * BigInt(10000 - slippageBps)) /
                        10000n;
                    return [4 /*yield*/, walletClient.writeContract({
                            address: routerAddr,
                            abi: abis_1.RedemptionRouterAbi,
                            functionName: "buy",
                            args: [
                                tokenAddress,
                                usdcAmountWei,
                                minTokensOut,
                                deadline,
                                referrerAddr,
                            ],
                        })];
                case 7:
                    buyTx = _a.sent();
                    return [4 /*yield*/, publicClient.waitForTransactionReceipt({ hash: buyTx })];
                case 8:
                    _a.sent();
                    setTxHash(buyTx);
                    setStep("confirmed");
                    return [3 /*break*/, 10];
                case 9:
                    e_1 = _a.sent();
                    setError((0, format_1.getErrorMessage)(e_1));
                    setStep("error");
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/];
            }
        });
    }); }, [isConnected, address, walletClient, publicClient]);
    var executeSell = (0, react_1.useCallback)(function (tokenAddress, tokenAmount, slippage) { return __awaiter(_this, void 0, void 0, function () {
        var routerAddr, allowance, approveTx, deadline, slippageBps, quotedUsdcOut, minUsdcOut, sellTx, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!isConnected || !address || !walletClient || !publicClient) {
                        setError("Connect wallet first");
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 9, , 10]);
                    setError(null);
                    setStep("approving");
                    routerAddr = addresses_1.ADDRESSES.redemptionRouter;
                    return [4 /*yield*/, publicClient.readContract({
                            address: tokenAddress,
                            abi: abis_1.erc20Abi,
                            functionName: "allowance",
                            args: [address, routerAddr],
                        })];
                case 2:
                    allowance = _a.sent();
                    if (!(allowance < tokenAmount)) return [3 /*break*/, 5];
                    return [4 /*yield*/, walletClient.writeContract({
                            address: tokenAddress,
                            abi: abis_1.erc20Abi,
                            functionName: "approve",
                            args: [routerAddr, viem_1.maxUint256],
                        })];
                case 3:
                    approveTx = _a.sent();
                    return [4 /*yield*/, publicClient.waitForTransactionReceipt({ hash: approveTx })];
                case 4:
                    _a.sent();
                    _a.label = 5;
                case 5:
                    setStep("executing");
                    deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
                    slippageBps = slippageToBps(slippage);
                    return [4 /*yield*/, publicClient.simulateContract({
                            address: routerAddr,
                            abi: abis_1.RedemptionRouterAbi,
                            functionName: "sell",
                            args: [
                                tokenAddress,
                                tokenAmount,
                                0n,
                                deadline,
                            ],
                            account: address,
                        })];
                case 6:
                    quotedUsdcOut = (_a.sent()).result;
                    minUsdcOut = (quotedUsdcOut * BigInt(10000 - slippageBps)) / 10000n;
                    return [4 /*yield*/, walletClient.writeContract({
                            address: routerAddr,
                            abi: abis_1.RedemptionRouterAbi,
                            functionName: "sell",
                            args: [
                                tokenAddress,
                                tokenAmount,
                                minUsdcOut,
                                deadline,
                            ],
                        })];
                case 7:
                    sellTx = _a.sent();
                    return [4 /*yield*/, publicClient.waitForTransactionReceipt({ hash: sellTx })];
                case 8:
                    _a.sent();
                    setTxHash(sellTx);
                    setStep("confirmed");
                    return [3 /*break*/, 10];
                case 9:
                    e_2 = _a.sent();
                    setError((0, format_1.getErrorMessage)(e_2));
                    setStep("error");
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/];
            }
        });
    }); }, [isConnected, address, walletClient, publicClient]);
    var reset = (0, react_1.useCallback)(function () {
        setStep("idle");
        setTxHash(null);
        setError(null);
    }, []);
    return {
        step: step,
        txHash: txHash,
        error: error,
        executeBuy: executeBuy,
        executeSell: executeSell,
        reset: reset,
    };
}
