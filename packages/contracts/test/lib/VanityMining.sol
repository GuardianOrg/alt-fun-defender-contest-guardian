// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Solidity-side mirror of the frontend vanity miner
///         (`packages/shared/src/vanity.ts`). Brute-forces a `userSalt`
///         such that the predicted clone address ends in
///         `VANITY_TRAILING_ZEROS = 5` zero hex chars (i.e. `0x…00000`).
///         Test/script-only: used by Foundry tests (`DeployHelper`,
///         `Clones.t.sol`) and the E2E deploy script (`E2ETest.s.sol`) to
///         generate real launch-ready salts. Not referenced by any
///         production contract — production launches mine off-chain in
///         the JS Web Worker pool and submit the salt to `Bonding.launch`.
///
///         Pure value match — digits 0-9 render identically regardless of
///         EIP-55 checksum casing, so no second keccak step is needed.
///         Production launches use the JS Web Worker miner with an
///         equivalent predicate via a different code shape: the worker
///         does `tail.endsWith(suffix)` over the address's lowercase hex
///         string, which for an all-digit `suffix = "00000"` is exactly
///         equivalent to the low-20-bits mask check used here. Equality
///         of the address-derivation half is pinned by
///         `test_predictTokenAddress_matchesOZHelper` in `test/Clones.t.sol`.
library VanityMining {
    /// @dev EIP-1167 *creation*-code, OpenZeppelin v5 layout used by
    ///      `Clones.cloneDeterministic` (longer suffix than the original spec).
    ///      Embedded so the miner can compute CREATE2 addresses without
    ///      round-tripping through the OZ library each iteration.
    bytes internal constant EIP1167_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes internal constant EIP1167_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    /// @dev Mirror of `Bonding.VANITY_TRAILING_ZEROS`. Kept as a separate
    ///      constant rather than imported because libraries can't reach
    ///      contract-level constants without coupling them at the type
    ///      level. Comment in `Bonding.sol` flags both locations as the
    ///      single source of truth — keep them in lockstep.
    ///
    ///      Must remain a direct numeric literal: Solidity's inline
    ///      assembly rejects constants defined by expressions, and the
    ///      mining hot loop derives its mask from this value in Yul.
    uint256 internal constant TRAILING_ZEROS = 5;

    /// @dev Brute-force a `userSalt` so the resulting clone address ends in
    ///      `TRAILING_ZEROS` zero hex chars (low `TRAILING_ZEROS * 4` bits
    ///      all zero). ~1 M attempts on average for the production length
    ///      of 5; loop cap 16 M (P(no hit) ≈ 1.1e-7).
    ///
    ///      The salt is bound to `(creator_, nameHash, tickerHash)` so a
    ///      salt mined for one (name, ticker) pair will not validate against
    ///      a different one — changing the symbol or name forces a fresh
    ///      mine. `nameHash` and `tickerHash` are `keccak256(bytes(...))` of
    ///      the UTF-8 bytes; the caller pre-hashes so this loop only ever
    ///      moves fixed-size 32-byte words.
    ///
    ///      Assembly hot-loop reuses scratch buffers so memory expansion
    ///      stays O(1) — without this, ~1 M iterations would balloon
    ///      memory-cost gas.
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
        // `found == bytes32(0)` is a *valid* mining outcome (e.g. when `baseSalt`
        // is 0 and iteration 0 happens to produce a `…00000` address — ~1/1M
        // chance per call). Track convergence in a separate flag so the
        // post-loop `require` doesn't false-reject the legitimate zero salt.
        bool success;
        assembly ("memory-safe") {
            let mixBuf := mload(0x40)
            let addrBuf := add(mixBuf, 0x80)
            mstore(0x40, add(addrBuf, 0x80))

            // Derive the suffix mask once, outside the loop, from the
            // single source of truth. `TRAILING_ZEROS` is a direct numeric
            // constant so Solidity allows referencing it from Yul; the
            // shl/sub fold to compile-time literals during inline-assembly
            // optimisation, costing zero runtime gas. Keeping this here
            // (instead of a hardcoded `0xfffff`) means a future change to
            // `TRAILING_ZEROS` automatically propagates.
            let mask := sub(shl(mul(TRAILING_ZEROS, 4), 1), 1)

            mstore(mixBuf, creator_)
            mstore(add(mixBuf, 0x20), nameHash)
            mstore(add(mixBuf, 0x40), tickerHash)

            // addrBuf layout: [0xff (1) | bonding (20) | mixed (32) | initHash (32)]
            mstore8(addrBuf, 0xff)
            // shl(96) left-aligns the 20 address bytes immediately after the 0xff.
            mstore(add(addrBuf, 1), shl(96, bondingAddr))
            mstore(add(addrBuf, 53), initCodeHash)

            for { let i := 0 } lt(i, 16000000) { i := add(i, 1) } {
                let salt := add(baseSalt, i)
                mstore(add(mixBuf, 0x60), salt)
                let mixed := keccak256(mixBuf, 0x80)
                mstore(add(addrBuf, 21), mixed)
                let predicted := keccak256(addrBuf, 85)
                if iszero(and(predicted, mask)) {
                    found := salt
                    success := 1
                    break
                }
            }
        }

        require(success, "VanityMining: did not converge in 16M attempts");
    }
}
