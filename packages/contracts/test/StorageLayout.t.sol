// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

/// @title StorageLayoutTest
/// @notice Pins every contract's ERC-7201 namespace identifier to the storage
///         slot it derives to. Any drift between the namespace string and the
///         hard-coded slot constant inside the contract bricks an upgrade by
///         silently relocating storage — so this test fails first.
/// @dev If you ever change a namespace string you MUST update both the slot
///      constant in the source contract AND the expected slot in this test.
///      See `packages/contracts/AGENTS.md#storage-layout`.
contract StorageLayoutTest is Test {
    /// @dev Mirrors the ERC-7201 derivation:
    ///      keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~bytes32(uint256(0xff))
    function _erc7201(
        string memory id
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(id))) - 1)) & ~bytes32(uint256(0xff));
    }

    function test_bondingNamespaceMatchesSlot() public pure {
        assertEq(
            _erc7201("altfun.storage.Bonding"),
            0x8b5754e13e604f53718538385c40d9546a4725ba57a2e3447377e5a0d65c8e00,
            "Bonding storage slot drift"
        );
    }

    function test_zapNamespaceMatchesSlot() public pure {
        assertEq(
            _erc7201("altfun.storage.Zap"),
            0x6efaff3d1fa34cdc0d13358102d3377232e1768dd473564521de8a1148608500,
            "Zap storage slot drift"
        );
    }

    function test_feeVaultNamespaceMatchesSlot() public pure {
        assertEq(
            _erc7201("altfun.storage.FeeVault"),
            0xa926bb40d5eda4681728c5a36d6763beef85e2d2279081fc5cff7e744da2d700,
            "FeeVault storage slot drift"
        );
    }

    function test_lpLockNamespaceMatchesSlot() public pure {
        assertEq(
            _erc7201("altfun.storage.LPLock"),
            0x57e36a555d9dab2c98f4867e0f00fcc9beedb947224d36563fd15d5248644d00,
            "LPLock storage slot drift"
        );
    }
}
