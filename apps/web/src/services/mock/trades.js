"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOCK_HOLDERS = exports.MOCK_COMMENTS = exports.INITIAL_TOKEN_TRADES = void 0;
exports.generateFeedTrade = generateFeedTrade;
exports.generateTokenTrade = generateTokenTrade;
var constants_1 = require("../../config/constants");
var FEED_TOKEN_NAMES = [
    "MOONBOUND",
    "HOUSE",
    "CRASHOUT",
    "WAVEBEAR",
    "HYPERVADER",
    "DOOMER",
    "BTCMAXI",
];
var WALLETS = [
    "0x9c…11",
    "0x4f…3a",
    "0x7b…cc",
    "0x2e…f0",
    "0x8a…12",
    "0x1d…c4",
    "0x5f…88",
    "0x3c…f2",
];
var tradeIdCounter = 0;
var feedSeconds = 4;
var tokenTradeSeconds = 4;
function randomWallet() {
    return WALLETS[Math.floor(Math.random() * WALLETS.length)];
}
function randomHex() {
    return Math.random().toString(16).slice(2, 4);
}
function generateTrade(source) {
    var isFeed = source === "feed";
    var token = isFeed
        ? FEED_TOKEN_NAMES[Math.floor(Math.random() * FEED_TOKEN_NAMES.length)]
        : "MOONBOUND";
    var side = Math.random() > 0.28 ? "BUY" : "SELL";
    var amt = Math.floor(Math.random() * 60 + 1) * 50;
    var wallet = isFeed ? "0x".concat(randomHex(), "\u2026").concat(randomHex()) : randomWallet();
    var seconds = isFeed ? feedSeconds : tokenTradeSeconds;
    var m = String(Math.floor(seconds / 60)).padStart(2, "0");
    var s = String(seconds % 60).padStart(2, "0");
    if (isFeed)
        feedSeconds += Math.floor(Math.random() * 4 + 1);
    else
        tokenTradeSeconds += Math.floor(Math.random() * 4 + 1);
    tradeIdCounter++;
    return {
        id: "".concat(source, "-").concat(tradeIdCounter),
        side: side,
        amountUsd: amt,
        tokensAmount: "".concat((amt / constants_1.MOCK_TOKEN_PRICE / 1e6).toFixed(1), "M"),
        walletAddress: wallet,
        timestamp: "".concat(m, ":").concat(s),
        tokenAddress: isFeed ? "" : "0x3f4a8b2c9d1e5f7a100000000000babe",
        tokenName: token,
    };
}
function generateFeedTrade() {
    return generateTrade("feed");
}
function generateTokenTrade() {
    return generateTrade("token");
}
exports.INITIAL_TOKEN_TRADES = [
    {
        id: "init-1",
        side: "BUY",
        amountUsd: 5000,
        tokensAmount: "26.6M",
        walletAddress: "0x1d…c4",
        timestamp: "00:04",
        tokenAddress: "",
        tokenName: "MOONBOUND",
    },
    {
        id: "init-2",
        side: "BUY",
        amountUsd: 2100,
        tokensAmount: "11.2M",
        walletAddress: "0x9c…11",
        timestamp: "00:17",
        tokenAddress: "",
        tokenName: "MOONBOUND",
    },
    {
        id: "init-3",
        side: "SELL",
        amountUsd: 320,
        tokensAmount: "1.7M",
        walletAddress: "0x7a…fe",
        timestamp: "00:31",
        tokenAddress: "",
        tokenName: "MOONBOUND",
    },
    {
        id: "init-4",
        side: "BUY",
        amountUsd: 840,
        tokensAmount: "4.5M",
        walletAddress: "0x4f…3a",
        timestamp: "00:48",
        tokenAddress: "",
        tokenName: "MOONBOUND",
    },
    {
        id: "init-5",
        side: "BUY",
        amountUsd: 1200,
        tokensAmount: "6.4M",
        walletAddress: "0x5f…88",
        timestamp: "01:02",
        tokenAddress: "",
        tokenName: "MOONBOUND",
    },
    {
        id: "init-6",
        side: "SELL",
        amountUsd: 190,
        tokensAmount: "1.0M",
        walletAddress: "0x8e…21",
        timestamp: "01:19",
        tokenAddress: "",
        tokenName: "MOONBOUND",
    },
];
exports.MOCK_COMMENTS = [
    {
        id: "c1",
        emoji: "🐸",
        address: "0x4f…3a",
        timeAgo: "2m ago",
        text: "HYPE pumping and this thing flying, lfg 🚀",
    },
    {
        id: "c2",
        emoji: "💀",
        address: "0x9c…11",
        timeAgo: "8m ago",
        text: "graduating before 5h mark, this is the one",
    },
    {
        id: "c3",
        emoji: "🦁",
        address: "0x2b…88",
        timeAgo: "14m ago",
        text: "3x leverage on HYPE during a green day = cheat code",
    },
];
exports.MOCK_HOLDERS = [
    {
        rank: 1,
        address: "0x9c…11",
        tokens: "124.2M",
        percentSupply: 12.4,
        isCreator: true,
    },
    {
        rank: 2,
        address: "0x4f…3a",
        tokens: "98.1M",
        percentSupply: 9.8,
        isCreator: false,
    },
    {
        rank: 3,
        address: "0x7b…cc",
        tokens: "71.4M",
        percentSupply: 7.1,
        isCreator: false,
    },
    {
        rank: 4,
        address: "0x2e…f0",
        tokens: "55.0M",
        percentSupply: 5.5,
        isCreator: false,
    },
];
