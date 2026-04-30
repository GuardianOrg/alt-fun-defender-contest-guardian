// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBounceFactory
/// @notice Minimal interface for the BounceTech Leveraged Token Factory.
/// @dev Source:
///      https://github.com/bounce-tech/bounce-smart-contracts/blob/main/src/Factory.sol
interface IBounceFactory {
    /// @notice True iff `ltAddress_` was deployed via this factory's `createLt`.
    /// @dev Becomes `false` again if BounceTech `redeployLt`s the LT.
    function ltExists(
        address ltAddress_
    ) external view returns (bool);
}
