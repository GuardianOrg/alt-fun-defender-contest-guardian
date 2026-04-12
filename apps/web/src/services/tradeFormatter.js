"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTokenBalance = formatTokenBalance;
exports.ponderTradeToTrade = ponderTradeToTrade;
var viem_1 = require("viem");
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
