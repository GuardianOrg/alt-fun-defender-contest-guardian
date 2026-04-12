"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.wagmiConfig = void 0;
var wagmi_1 = require("wagmi");
var chains_1 = require("./chains");
exports.wagmiConfig = (0, wagmi_1.createConfig)({
    chains: [chains_1.hyperEVM],
    transports: (_a = {},
        _a[chains_1.hyperEVM.id] = (0, wagmi_1.http)(import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm"),
        _a),
});
