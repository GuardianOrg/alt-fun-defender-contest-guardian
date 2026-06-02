// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IBounceLeveragedToken
/// @notice Interface for BounceTech Leveraged Token contracts.
/// @dev Source:
///      https://github.com/bounce-tech/bounce-smart-contracts/blob/main/src/LeveragedToken.sol
interface IBounceLeveragedToken is IERC20 {
    /// @notice USDC → LT.
    function mint(
        address to,
        uint256 baseAmount,
        uint256 minOut
    ) external returns (uint256 ltAmount);

    /// @notice LT → USDC. Reverts if the computed USDC output exceeds `baseAssetBalance()`.
    function redeem(
        address to,
        uint256 ltAmount,
        uint256 minBase
    ) external returns (uint256 baseAmount);

    /// @notice Idle USDC available for atomic redeem.
    function baseAssetBalance() external view returns (uint256);

    /// @notice USDC per LT unit, 18-dp.
    function exchangeRate() external view returns (uint256);

    /// @notice Equals the LT amount that `mint(_, baseAmount, _)` will produce
    ///         at the current `exchangeRate()`.
    function baseToLtAmount(
        uint256 baseAmount
    ) external view returns (uint256);

    /// @notice Inverse of `baseToLtAmount`. The round-trip
    ///         `baseToLtAmount(ltToBaseAmount(x))` may differ from `x` by 1
    ///         wei due to integer-division rounding.
    function ltToBaseAmount(
        uint256 ltAmount
    ) external view returns (uint256);

    function targetLeverage() external view returns (uint256);

    function isLong() external view returns (bool);

    function underlyingSymbol() external view returns (string memory);
}
