"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useWallet = useWallet;
var react_auth_1 = require("@privy-io/react-auth");
var wagmi_1 = require("wagmi");
var format_1 = require("../utils/format");
function useWallet() {
    var _a;
    var _b = (0, wagmi_1.useAccount)(), address = _b.address, wagmiConnected = _b.isConnected;
    var _c = (0, react_auth_1.usePrivy)(), login = _c.login, ready = _c.ready, authenticated = _c.authenticated;
    var wallets = (0, react_auth_1.useWallets)().wallets;
    var isConnected = wagmiConnected || (ready && authenticated && wallets.length > 0);
    var activeAddress = address !== null && address !== void 0 ? address : (_a = wallets[0]) === null || _a === void 0 ? void 0 : _a.address;
    var connectWallet = function () {
        login();
    };
    return {
        address: activeAddress,
        shortAddress: activeAddress ? (0, format_1.shortenAddress)(activeAddress) : undefined,
        isConnected: isConnected,
        connect: connectWallet,
    };
}
