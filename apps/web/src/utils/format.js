"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatUsd = formatUsd;
exports.formatPercent = formatPercent;
exports.shortenAddress = shortenAddress;
exports.formatTokenAmount = formatTokenAmount;
exports.cn = cn;
exports.getLtDisplayName = getLtDisplayName;
exports.getErrorMessage = getErrorMessage;
exports.copyToClipboard = copyToClipboard;
exports.formatTimeAgo = formatTimeAgo;
function formatUsd(value) {
    if (value >= 1000000)
        return "$".concat((value / 1000000).toFixed(2), "M");
    if (value >= 1000)
        return "$".concat((value / 1000).toFixed(value >= 10000 ? 0 : 1), "K");
    return "$".concat(value.toLocaleString(undefined, { maximumFractionDigits: 2 }));
}
function formatPercent(value) {
    var sign = value >= 0 ? "+" : "";
    return "".concat(sign).concat(value.toFixed(1), "%");
}
function shortenAddress(address) {
    if (address.length <= 10)
        return address;
    return "".concat(address.slice(0, 4), "\u2026").concat(address.slice(-4));
}
function formatTokenAmount(value) {
    if (value >= 1000000)
        return "".concat((value / 1000000).toFixed(1), "M");
    if (value >= 1000)
        return "".concat((value / 1000).toFixed(1), "K");
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function cn() {
    var classes = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        classes[_i] = arguments[_i];
    }
    return classes.filter(Boolean).join(" ");
}
function getLtDisplayName(asset, leverage, direction) {
    return "".concat(asset, " ").concat(leverage, "\u00D7 ").concat(direction === "long" ? "Long" : "Short");
}
function getErrorMessage(e) {
    var raw = e instanceof Error ? e.message : String(e);
    var lower = raw.toLowerCase();
    if (raw.includes("InsufficientBalance") || (lower.includes("insufficient") && lower.includes("balance"))) {
        return "Sell exceeds available liquidity. Try a smaller amount — buffer replenishes in ~10s.";
    }
    if (raw.includes("0x05eb05ac")) {
        return "Amount below BounceTech minimum ($10 USDC).";
    }
    return e instanceof Error ? e.message : "Transaction failed";
}
function copyToClipboard(text) {
    return navigator.clipboard.writeText(text).catch(function () { });
}
function formatTimeAgo(dateStr) {
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1)
        return "just now";
    if (mins < 60)
        return "".concat(mins, "m ago");
    var hours = Math.floor(mins / 60);
    if (hours < 24)
        return "".concat(hours, "h ago");
    var days = Math.floor(hours / 24);
    return "".concat(days, "d ago");
}
