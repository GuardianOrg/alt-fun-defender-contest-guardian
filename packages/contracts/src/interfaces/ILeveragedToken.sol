// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILeveragedToken
/// @notice Interface for BounceTech Leveraged Token contracts
interface ILeveragedToken {
    /// @notice Returns the current exchange rate of the LT in USDC terms
    /// @return The exchange rate scaled to 18 decimals
    function exchangeRate() external view returns (uint256);

    /// @notice Returns the leverage multiplier
    /// @return The leverage multiplier (e.g., 2, 3, 5)
    function leverage() external view returns (uint256);

    /// @notice Returns whether this is a long or short LT
    /// @return True if long, false if short
    function isLong() external view returns (bool);

    /// @notice Returns the underlying asset symbol
    function underlyingSymbol() external view returns (string memory);
}
