// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IBounceGlobalStorage
/// @notice Minimal interface for BounceTech's `GlobalStorage` contract.
/// @dev Source:
///      https://github.com/bounce-tech/bounce-smart-contracts/blob/main/src/GlobalStorage.sol
interface IBounceGlobalStorage {
    /// @notice Current BounceTech `Factory` address.
    function factory() external view returns (address);

    /// @notice Minimum base-asset (USDC, 6dp) amount accepted by LT
    ///         `mint`/`redeem`. Owner-settable on the BounceTech side.
    function minTransactionSize() external view returns (uint256);
}
