// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice On-chain mirror of the frontend vanity miner. Used by
///         `setTokenImplementation` (and tests) to verify a new impl can
///         produce a `0xa1fa`-suffixed clone before it bricks user launches.
///         The TypeScript copy in `packages/shared/src/vanity.ts` is
///         equality-checked against `Clones.predictDeterministicAddress` by
///         `test_predictTokenAddress_matchesOZHelper` in `test/Clones.t.sol`.
library VanityMining {
    /// @dev EIP-1167 *creation*-code, OpenZeppelin v5 layout used by
    ///      `Clones.cloneDeterministic` (longer suffix than the original spec).
    ///      Embedded so the miner can compute CREATE2 addresses without
    ///      round-tripping through the OZ library each iteration.
    bytes internal constant EIP1167_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes internal constant EIP1167_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    /// @dev Brute-force a `userSalt` so the resulting clone address ends in
    ///      `0xa1fa`. ~65k attempts on average.
    ///
    ///      The salt is bound to `(creator_, nameHash, tickerHash)` so a salt
    ///      mined for one (name, ticker) pair will not validate against a
    ///      different one — changing the symbol or name forces a fresh mine.
    ///      `nameHash` and `tickerHash` are `keccak256(bytes(...))` of the UTF-8
    ///      bytes; the caller pre-hashes so this loop only ever moves
    ///      fixed-size 32-byte words.
    ///
    ///      Assembly hot-loop reuses scratch buffers so memory expansion stays
    ///      O(1) — without this, ~65k iterations hit `MemoryOOG`.
    ///        `mixBuf` (128): [creator (32) | nameHash (32) | tickerHash (32) |
    ///                          salt (32)] → keccak → mixed
    ///        `addrBuf` (85): [0xff | bonding (20) | mixed (32) | initHash (32)]
    ///                        → keccak → predicted address
    function mine(
        address creator_,
        bytes32 nameHash,
        bytes32 tickerHash,
        address implementation_,
        address bondingAddr,
        bytes32 baseSalt
    ) internal pure returns (bytes32 found) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(EIP1167_PREFIX, implementation_, EIP1167_SUFFIX));
        assembly ("memory-safe") {
            let mixBuf := mload(0x40)
            let addrBuf := add(mixBuf, 0x80)
            mstore(0x40, add(addrBuf, 0x80))

            mstore(mixBuf, creator_)
            mstore(add(mixBuf, 0x20), nameHash)
            mstore(add(mixBuf, 0x40), tickerHash)

            // addrBuf layout: [0xff (1) | bonding (20) | mixed (32) | initHash (32)]
            mstore8(addrBuf, 0xff)
            // shl(96) left-aligns the 20 address bytes immediately after the 0xff.
            mstore(add(addrBuf, 1), shl(96, bondingAddr))
            mstore(add(addrBuf, 53), initCodeHash)

            for { let i := 0 } lt(i, 1000000) { i := add(i, 1) } {
                let salt := add(baseSalt, i)
                mstore(add(mixBuf, 0x60), salt)
                let mixed := keccak256(mixBuf, 0x80)
                mstore(add(addrBuf, 21), mixed)
                let predicted := keccak256(addrBuf, 85)
                if eq(and(predicted, 0xffff), 0xa1fa) {
                    found := salt
                    break
                }
            }
        }

        require(found != bytes32(0), "VanityMining: did not converge in 1M attempts");
    }
}
