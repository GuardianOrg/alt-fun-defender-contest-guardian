// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Off-chain vanity-suffix miner for `Bonding`'s
///         `Clones.cloneDeterministic`-based token launches. Both the test
///         helper (`test/DeployHelper.sol`) and the e2e script
///         (`script/E2ETest.s.sol`) call into this library so the
///         EIP-1167 init-code layout and the assembly hot loop live in a
///         single canonical place. The frontend Web Worker miner in
///         `packages/shared/src/vanity.ts` is the third copy (TypeScript) and
///         is byte-for-byte equality-checked against the OZ Clones helper by
///         `test_predictTokenAddress_matchesOZHelper` in `test/Clones.t.sol`.
///
///         All functions are `internal pure`, so the library adds no bytecode
///         to consumers — it's purely a code-organisation device.
library VanityMining {
    /// @dev EIP-1167 minimal-proxy *creation*-code prefix/suffix, in the
    ///      OpenZeppelin v5 layout used by `Clones.cloneDeterministic`
    ///      (longer suffix than the original spec — see notes in
    ///      `packages/shared/src/vanity.ts`). Embedded here so the miner
    ///      can compute CREATE2 addresses without round-tripping through
    ///      the OZ library on every iteration.
    bytes internal constant EIP1167_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes internal constant EIP1167_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    /// @dev Brute-force a `userSalt` such that
    ///      `Clones.cloneDeterministic(implementation_, _mixSalt(creator_, userSalt))`
    ///      from `bondingAddr` deploys to an address ending in
    ///      `Bonding.VANITY_SUFFIX` (`0xa1fa`). Mirrors the off-chain Web
    ///      Worker miner used by the frontend. ~65k attempts on average.
    ///
    ///      Fully assembly-driven hot loop: reuses two 64- and 85-byte
    ///      buffers in scratch memory so memory expansion cost stays at
    ///      O(1) instead of O(N) — without this, ~65k iterations blow past
    ///      the EVM memory gas limit (`MemoryOOG`).
    ///
    ///      `mixBuf` (64 bytes): [creator (32) | salt (32)]  → keccak → mixed
    ///      `addrBuf` (85 bytes): [0xff | bonding (20) | mixed (32) | initHash (32)]
    ///                             → keccak → predicted address
    function mine(
        address creator_,
        address implementation_,
        address bondingAddr,
        bytes32 baseSalt
    ) internal pure returns (bytes32 found) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(EIP1167_PREFIX, implementation_, EIP1167_SUFFIX));
        assembly ("memory-safe") {
            let mixBuf := mload(0x40)
            let addrBuf := add(mixBuf, 0x40)
            mstore(0x40, add(addrBuf, 0x80)) // bump free pointer once

            // Static fields in mixBuf.
            mstore(mixBuf, creator_) // address right-aligned in 32 bytes

            // Static fields in addrBuf. byte 0 = 0xff, bytes 1..20 =
            // bonding, bytes 21..52 = mixed, bytes 53..84 = initCodeHash.
            // Then keccak256(addrBuf, 85).
            mstore8(addrBuf, 0xff)
            // Pack bonding into bytes [1..20]. Address sits in low 20
            // bytes of a word, so shift left by (32-20-1)*8 = 88 bits to
            // align — but we store at offset 1 with shl(96, ...) which
            // places the 20 address bytes immediately after the 0xff.
            mstore(add(addrBuf, 1), shl(96, bondingAddr))
            // initCodeHash at bytes [53..84].
            mstore(add(addrBuf, 53), initCodeHash)

            for { let i := 0 } lt(i, 1000000) { i := add(i, 1) } {
                // userSalt = baseSalt + i (overflow-wrapped, fine).
                let salt := add(baseSalt, i)
                mstore(add(mixBuf, 0x20), salt)
                let mixed := keccak256(mixBuf, 0x40)
                mstore(add(addrBuf, 21), mixed)
                let predicted := keccak256(addrBuf, 85)
                // Address is the low 20 bytes of `predicted`. We want the
                // last 2 bytes to equal 0xa1fa. Mask out everything but
                // the low 16 bits and compare.
                if eq(and(predicted, 0xffff), 0xa1fa) {
                    found := salt
                    break
                }
            }
        }

        require(found != bytes32(0), "VanityMining: did not converge in 1M attempts");
    }
}
