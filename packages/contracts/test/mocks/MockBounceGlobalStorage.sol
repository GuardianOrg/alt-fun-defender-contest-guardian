// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBounceGlobalStorage} from "../../src/interfaces/IBounceGlobalStorage.sol";

/// @dev Mock of BounceTech's `GlobalStorage` for testing. Just exposes the
///      `factory()` getter that `Bonding.launch` consults — tests can point
///      it at a `MockBounceFactory` (or rotate it mid-test to exercise
///      `Bonding`'s "factory is resolved live every launch" guarantee).
contract MockBounceGlobalStorage is IBounceGlobalStorage {
    address public override factory;

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
}
