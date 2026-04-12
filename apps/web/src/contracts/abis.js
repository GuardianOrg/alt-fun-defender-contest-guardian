"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.erc20Abi = exports.LeveragedTokenAbi = exports.LPLockAbi = exports.FERC20Abi = exports.FFactoryAbi = exports.RedemptionRouterAbi = exports.BondingAbi = void 0;
var shared_1 = require("@launchpad/shared");
Object.defineProperty(exports, "BondingAbi", { enumerable: true, get: function () { return shared_1.BondingAbi; } });
Object.defineProperty(exports, "RedemptionRouterAbi", { enumerable: true, get: function () { return shared_1.RedemptionRouterAbi; } });
Object.defineProperty(exports, "FFactoryAbi", { enumerable: true, get: function () { return shared_1.FFactoryAbi; } });
Object.defineProperty(exports, "FERC20Abi", { enumerable: true, get: function () { return shared_1.FERC20Abi; } });
Object.defineProperty(exports, "LPLockAbi", { enumerable: true, get: function () { return shared_1.LPLockAbi; } });
Object.defineProperty(exports, "LeveragedTokenAbi", { enumerable: true, get: function () { return shared_1.LeveragedTokenAbi; } });
exports.erc20Abi = [
    {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
];
