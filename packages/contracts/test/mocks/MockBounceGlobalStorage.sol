// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBounceGlobalStorage} from "../../src/interfaces/IBounceGlobalStorage.sol";

/// @dev Mock of BounceTech's `GlobalStorage` for testing. Exposes the
///      `factory()` getter that `Bonding.launch` consults — tests can point
///      it at a `MockBounceFactory` (or rotate it mid-test to exercise
///      `Bonding`'s "factory is resolved live every launch" guarantee) — and
///      the `minTransactionSize()` floor that `Zap` reads live. Defaults to
///      `10e6` ($10), the live mainnet value, so suites that don't touch it
///      see the historical floor.
contract MockBounceGlobalStorage is IBounceGlobalStorage {
    address public override factory;
    uint256 public override minTransactionSize = 10e6;

    constructor(
        address factory_
    ) {
        factory = factory_;
    }

    function setFactory(
        address factory_
    ) external {
        factory = factory_;
    }

    function setMinTransactionSize(
        uint256 size
    ) external {
        minTransactionSize = size;
    }
}
