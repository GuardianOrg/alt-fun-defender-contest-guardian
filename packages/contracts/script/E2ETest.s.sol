// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {Zap} from "../src/Zap.sol";
import {IPair} from "../src/interfaces/IPair.sol";

contract E2ETest is Script {
    /// @dev Pinned LT on HyperEVM mainnet — same `HYPE2L` used by the test
    ///      suite in `DeployHelper.sol`. Not deployed by us, so it stays a
    ///      constant rather than a per-deploy env var.
    address constant HYPE2L = 0x0f8db745e9C28275F8B6e2BAF6BAA8eE7431b557;

    /// @dev Defaults track the currently-live deployment recorded in
    ///      `packages/shared/src/constants/addresses.ts`. Override via
    ///      `BONDING_ADDRESS` / `ZAP_ADDRESS` env vars when
    ///      pointing the script at a different deployment (staging, fork,
    ///      next mainnet rev, etc.) so the script stays runnable without a
    ///      recompile after every upgrade.
    address constant DEFAULT_BONDING = 0x06dA483b9BaAfF21942D034A8E027e32d93E77CE;
    address constant DEFAULT_ZAP = 0x38c3EdA163A6ae77427D36Aa284667D605b7A907;

    /// @dev Same EIP-1167 v5 layout as `DeployHelper._EIP1167_*` and
    ///      `packages/shared/src/vanity.ts`. Kept inline here so the script
    ///      doesn't take a test-helper dependency.
    bytes constant _EIP1167_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes constant _EIP1167_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);

        address bondingAddr = vm.envOr("BONDING_ADDRESS", DEFAULT_BONDING);
        address zapAddr = vm.envOr("ZAP_ADDRESS", DEFAULT_ZAP);
        console.log("Bonding:", bondingAddr);
        console.log("Zap:", zapAddr);

        Bonding bonding = Bonding(bondingAddr);
        Zap zap = Zap(zapAddr);

        // Mine a vanity salt off-broadcast — `Bonding._deployAndSeed` reverts
        // with `NotVanityAddress` unless the resulting address ends in
        // `Bonding.VANITY_SUFFIX` (`0xa1fa`). Pulling `tokenImplementation()`
        // from the live Bonding (rather than hardcoding) means a future
        // `Token` implementation upgrade doesn't break the script.
        bytes32 vanitySalt = _mineVanitySalt(
            deployer, bonding.tokenImplementation(), bondingAddr, keccak256(abi.encode(block.timestamp))
        );
        console.log("Mined vanity salt:");
        console.logBytes32(vanitySalt);

        vm.startBroadcast(pk);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "E2E Test Token",
            ticker: "E2E",
            description: "End-to-end test",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: HYPE2L,
            salt: vanitySalt
        });

        address tokenAddr = zap.createToken(params, 0);
        console.log("Token:", tokenAddr);

        vm.stopBroadcast();

        Bonding.TokenInfo memory info = bonding.getTokenInfo(tokenAddr);
        address pairAddr = info.pair;
        console.log("Pair:", pairAddr);

        IPair pair = IPair(pairAddr);
        (uint256 rt, uint256 ra) = pair.getReserves();
        console.log("Reserve token:", rt);
        console.log("Reserve asset:", ra);
        console.log("Trading:", bonding.isTrading(tokenAddr));
        console.log("Tokens count:", bonding.allTokensLength());
    }

    /// @dev Off-broadcast mining loop — mirrors `DeployHelper._mineVanitySaltForImpl`
    ///      and the frontend Web Worker. Inline assembly so memory expansion
    ///      stays O(1) across the ~65k expected iterations.
    function _mineVanitySalt(
        address creator_,
        address implementation_,
        address bondingAddr,
        bytes32 baseSalt
    ) internal pure returns (bytes32 found) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(_EIP1167_PREFIX, implementation_, _EIP1167_SUFFIX));
        assembly ("memory-safe") {
            let mixBuf := mload(0x40)
            let addrBuf := add(mixBuf, 0x40)
            mstore(0x40, add(addrBuf, 0x80))
            mstore(mixBuf, creator_)
            mstore8(addrBuf, 0xff)
            mstore(add(addrBuf, 1), shl(96, bondingAddr))
            mstore(add(addrBuf, 53), initCodeHash)

            for { let i := 0 } lt(i, 1000000) { i := add(i, 1) } {
                let salt := add(baseSalt, i)
                mstore(add(mixBuf, 0x20), salt)
                let mixed := keccak256(mixBuf, 0x40)
                mstore(add(addrBuf, 21), mixed)
                let predicted := keccak256(addrBuf, 85)
                if eq(and(predicted, 0xffff), 0xa1fa) {
                    found := salt
                    break
                }
            }
        }
        require(found != bytes32(0), "E2ETest: vanity mining did not converge in 1M attempts");
    }
}
