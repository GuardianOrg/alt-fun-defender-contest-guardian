"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USDC_DECIMALS = exports.ADDRESSES = void 0;
var shared_1 = require("@launchpad/shared");
exports.ADDRESSES = {
    bonding: shared_1.CONTRACT_ADDRESSES.bonding,
    factory: shared_1.CONTRACT_ADDRESSES.factory,
    router: shared_1.CONTRACT_ADDRESSES.router,
    redemptionRouter: shared_1.CONTRACT_ADDRESSES.redemptionRouter,
    lpLock: shared_1.CONTRACT_ADDRESSES.lpLock,
    usdc: shared_1.USDC_ADDRESS,
};
exports.USDC_DECIMALS = 6;
