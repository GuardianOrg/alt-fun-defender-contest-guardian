"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hyperEVM = void 0;
var viem_1 = require("viem");
exports.hyperEVM = (0, viem_1.defineChain)({
    id: 999,
    name: "HyperEVM",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: {
        default: {
            http: [import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm"],
        },
    },
    blockExplorers: {
        default: {
            name: "HyperEVM Explorer",
            url: "https://explorer.hyperliquid.xyz",
        },
    },
});
