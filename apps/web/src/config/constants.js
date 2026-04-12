"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEVERAGE_OPTIONS = exports.UNDERLYING_ASSETS = exports.SEED_PCT_OPTIONS = exports.QUICK_AMOUNTS = exports.SLIPPAGE_OPTIONS = exports.TOKEN_SUPPLY = exports.DEFAULT_REFERRAL_CODE = exports.FEES = exports.MOCK_TOKEN_PRICE = exports.GRADUATION_THRESHOLD_USD = void 0;
exports.GRADUATION_THRESHOLD_USD = 12000;
exports.MOCK_TOKEN_PRICE = 0.000188;
exports.FEES = {
    /** 0.5% on buy — split 0.4% protocol / 0.1% creator */
    curveBuy: 0.005,
    /** 0.5% on sell — split 0.4% protocol / 0.1% creator */
    curveSell: 0.005,
    /** 0.3% on notional (USD × leverage) — sells only, 100% protocol */
    ltRedemption: 0.003,
    protocolSplit: 0.004,
    creatorSplit: 0.001,
};
/**
 * Default referral code for the Referral Module.
 * Set to bytes32(0) for no referral — replace with partner codes in production.
 */
exports.DEFAULT_REFERRAL_CODE = "0x0000000000000000000000000000000000000000000000000000000000000000";
exports.TOKEN_SUPPLY = 1000000000;
exports.SLIPPAGE_OPTIONS = [0.005, 0.01, 0.02];
exports.QUICK_AMOUNTS = [50, 100, 500, 1000];
exports.SEED_PCT_OPTIONS = [
    { pct: 1, usd: 28 },
    { pct: 10, usd: 302 },
    { pct: 30, usd: 1096 },
    { pct: 50, usd: 2314 },
    { pct: 80, usd: 6906 },
];
exports.UNDERLYING_ASSETS = [
    "HYPE",
    "ETH",
    "BTC",
    "SOL",
    "ARB",
    "OP",
];
exports.LEVERAGE_OPTIONS = [2, 3, 5];
