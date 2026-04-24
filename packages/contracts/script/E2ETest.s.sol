// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {LaunchpadRouter} from "../src/LaunchpadRouter.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";

contract E2ETest is Script {
    address constant HYPE2L = 0x0f8db745e9C28275F8B6e2BAF6BAA8eE7431b557;
    address constant BONDING = 0x1944710C55ac3Dcbf36ED9B80f289418B26c032a;
    address constant LAUNCHPAD_ROUTER = 0x3E86AFB20De663f8689C09698aEeF3DF5F28a1Fe;

    /// @dev Same EIP-1167 v5 layout as `DeployHelper._EIP1167_*` and
    ///      `packages/shared/src/vanity.ts`. Kept inline here so the script
    ///      doesn't take a test-helper dependency.
    bytes constant _EIP1167_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes constant _EIP1167_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);

        Bonding bonding = Bonding(BONDING);
        LaunchpadRouter router = LaunchpadRouter(LAUNCHPAD_ROUTER);

        // Mine a vanity salt off-broadcast — `Bonding._deployAndSeed` reverts
        // with `NotVanityAddress` unless the resulting address ends in
        // `Bonding.VANITY_SUFFIX` (`0xa1fa`).
        bytes32 vanitySalt =
            _mineVanitySalt(deployer, bonding.tokenImplementation(), BONDING, keccak256(abi.encode(block.timestamp)));
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

        address tokenAddr = router.createToken(params, 0);
        console.log("Token:", tokenAddr);

        vm.stopBroadcast();

        Bonding.TokenInfo memory info = bonding.getTokenInfo(tokenAddr);
        address pairAddr = info.pair;
        console.log("Pair:", pairAddr);

        IFPair pair = IFPair(pairAddr);
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
