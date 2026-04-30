// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBounceGlobalStorage
/// @notice Minimal interface for BounceTech's `GlobalStorage` contract.
/// @dev Source:
///      https://github.com/bounce-tech/bounce-smart-contracts/blob/main/src/GlobalStorage.sol
interface IBounceGlobalStorage {
    /// @notice Current BounceTech `Factory` address.
    function factory() external view returns (address);
}
