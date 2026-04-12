"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.useCreateToken = useCreateToken;
var react_1 = require("react");
var shared_1 = require("@launchpad/shared");
var viem_1 = require("viem");
var wagmi_1 = require("wagmi");
var abis_1 = require("../contracts/abis");
var addresses_1 = require("../contracts/addresses");
var api_1 = require("../services/api");
var format_1 = require("../utils/format");
function fetchLTs() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, (0, api_1.fetchLeveragedTokens)()];
        });
    });
}
function useCreateToken() {
    var _this = this;
    var _a = (0, wagmi_1.useAccount)(), address = _a.address, isConnected = _a.isConnected;
    var publicClient = (0, wagmi_1.usePublicClient)();
    var walletClient = (0, wagmi_1.useWalletClient)().data;
    var _b = (0, react_1.useState)("idle"), step = _b[0], setStep = _b[1];
    var _c = (0, react_1.useState)(null), error = _c[0], setError = _c[1];
    var _d = (0, react_1.useState)(null), tokenAddress = _d[0], setTokenAddress = _d[1];
    var create = (0, react_1.useCallback)(function (params) { return __awaiter(_this, void 0, void 0, function () {
        var lts, isLong, lt, usdcAmount, allowance, approveTx, socials, launchParams, seedUsdcAmount, tx, receipt, tokenCreatedEvents, newTokenAddr, imageUrl, uploaded, _a, ltDir, normalizedToken, normalizedCreator, apiPayload, message, signature, _b, e_1;
        var _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        return __generator(this, function (_q) {
            switch (_q.label) {
                case 0:
                    if (!isConnected || !address || !walletClient || !publicClient) {
                        setError("Connect wallet first");
                        return [2 /*return*/];
                    }
                    _q.label = 1;
                case 1:
                    _q.trys.push([1, 19, , 20]);
                    setError(null);
                    setStep("approving");
                    return [4 /*yield*/, fetchLTs()];
                case 2:
                    lts = _q.sent();
                    isLong = params.direction === "long";
                    lt = (0, shared_1.findLT)(lts, params.underlying, params.leverage, isLong);
                    if (!lt) {
                        throw new Error("No LT found for ".concat(params.underlying, " ").concat(params.leverage, "\u00D7 ").concat(params.direction));
                    }
                    if (!(params.seedBuyUsd > 0)) return [3 /*break*/, 6];
                    usdcAmount = (0, viem_1.parseUnits)(params.seedBuyUsd.toString(), addresses_1.USDC_DECIMALS);
                    return [4 /*yield*/, publicClient.readContract({
                            address: addresses_1.ADDRESSES.usdc,
                            abi: abis_1.erc20Abi,
                            functionName: "allowance",
                            args: [address, addresses_1.ADDRESSES.redemptionRouter],
                        })];
                case 3:
                    allowance = (_q.sent());
                    if (!(allowance < usdcAmount)) return [3 /*break*/, 6];
                    return [4 /*yield*/, walletClient.writeContract({
                            address: addresses_1.ADDRESSES.usdc,
                            abi: abis_1.erc20Abi,
                            functionName: "approve",
                            args: [addresses_1.ADDRESSES.redemptionRouter, viem_1.maxUint256],
                        })];
                case 4:
                    approveTx = _q.sent();
                    return [4 /*yield*/, publicClient.waitForTransactionReceipt({ hash: approveTx })];
                case 5:
                    _q.sent();
                    _q.label = 6;
                case 6:
                    setStep("deploying");
                    socials = (_c = params.socialLinks) !== null && _c !== void 0 ? _c : [];
                    launchParams = {
                        name: params.name,
                        ticker: params.ticker,
                        description: params.description,
                        image: "",
                        urls: [
                            (_d = socials[0]) !== null && _d !== void 0 ? _d : "",
                            (_e = socials[1]) !== null && _e !== void 0 ? _e : "",
                            (_f = socials[2]) !== null && _f !== void 0 ? _f : "",
                            (_g = socials[3]) !== null && _g !== void 0 ? _g : "",
                        ],
                        ltAddress: lt.address,
                        purchaseAmount: 0n,
                    };
                    seedUsdcAmount = params.seedBuyUsd > 0
                        ? (0, viem_1.parseUnits)(params.seedBuyUsd.toString(), addresses_1.USDC_DECIMALS)
                        : 0n;
                    return [4 /*yield*/, walletClient.writeContract({
                            address: addresses_1.ADDRESSES.redemptionRouter,
                            abi: abis_1.RedemptionRouterAbi,
                            functionName: "createToken",
                            args: [launchParams, seedUsdcAmount],
                        })];
                case 7:
                    tx = _q.sent();
                    return [4 /*yield*/, publicClient.waitForTransactionReceipt({
                            hash: tx,
                        })];
                case 8:
                    receipt = _q.sent();
                    tokenCreatedEvents = (0, viem_1.parseEventLogs)({
                        abi: abis_1.RedemptionRouterAbi,
                        eventName: "TokenCreated",
                        logs: receipt.logs,
                        strict: false,
                    });
                    newTokenAddr = (_k = (_j = (_h = tokenCreatedEvents[0]) === null || _h === void 0 ? void 0 : _h.args) === null || _j === void 0 ? void 0 : _j.token) !== null && _k !== void 0 ? _k : null;
                    imageUrl = "";
                    if (!params.imageFile) return [3 /*break*/, 12];
                    _q.label = 9;
                case 9:
                    _q.trys.push([9, 11, , 12]);
                    return [4 /*yield*/, (0, api_1.uploadImage)(params.imageFile)];
                case 10:
                    uploaded = _q.sent();
                    imageUrl = uploaded.url;
                    return [3 /*break*/, 12];
                case 11:
                    _a = _q.sent();
                    return [3 /*break*/, 12];
                case 12:
                    if (!newTokenAddr) return [3 /*break*/, 18];
                    _q.label = 13;
                case 13:
                    _q.trys.push([13, 16, , 17]);
                    ltDir = isLong ? "long" : "short";
                    normalizedToken = (0, viem_1.getAddress)(newTokenAddr);
                    normalizedCreator = (0, viem_1.getAddress)(address);
                    apiPayload = {
                        address: normalizedToken,
                        name: params.name,
                        ticker: params.ticker,
                        description: (_l = params.description) !== null && _l !== void 0 ? _l : "",
                        imageUrl: imageUrl,
                        ltPair: lt.symbol,
                        ltDirection: ltDir,
                        leverage: params.leverage,
                        twitterUrl: (_m = socials[0]) !== null && _m !== void 0 ? _m : "",
                        telegramUrl: (_o = socials[1]) !== null && _o !== void 0 ? _o : "",
                        websiteUrl: (_p = socials[2]) !== null && _p !== void 0 ? _p : "",
                        creator: normalizedCreator,
                    };
                    message = (0, shared_1.buildTokenCreationMessage)(apiPayload);
                    return [4 /*yield*/, walletClient.signMessage({ message: message })];
                case 14:
                    signature = _q.sent();
                    return [4 /*yield*/, (0, api_1.createTokenApi)(__assign(__assign({}, apiPayload), { signature: signature }))];
                case 15:
                    _q.sent();
                    return [3 /*break*/, 17];
                case 16:
                    _b = _q.sent();
                    return [3 /*break*/, 17];
                case 17:
                    setTokenAddress(newTokenAddr);
                    _q.label = 18;
                case 18:
                    setStep("confirmed");
                    return [3 /*break*/, 20];
                case 19:
                    e_1 = _q.sent();
                    setError((0, format_1.getErrorMessage)(e_1));
                    setStep("error");
                    return [3 /*break*/, 20];
                case 20: return [2 /*return*/];
            }
        });
    }); }, [isConnected, address, walletClient, publicClient]);
    var reset = (0, react_1.useCallback)(function () {
        setStep("idle");
        setError(null);
        setTokenAddress(null);
    }, []);
    return { step: step, error: error, tokenAddress: tokenAddress, create: create, reset: reset };
}
