// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBounceFactory} from "../../src/interfaces/IBounceFactory.sol";

/// @dev Mock of the BounceTech `Factory` for testing. Exposes the same
///      `ltExists` boolean mapping that the real factory uses, plus
///      `setLtExists` for tests to register / deregister LTs at will.
contract MockBounceFactory is IBounceFactory {
    mapping(address => bool) public override ltExists;

    function setLtExists(
        address ltAddress_,
        bool exists_
    ) external {
        ltExists[ltAddress_] = exists_;
    }
}
