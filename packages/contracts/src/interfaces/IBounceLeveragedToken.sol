// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IBounceLeveragedToken
/// @notice Interface for BounceTech Leveraged Token contracts.
/// @dev Source:
///      https://github.com/bounce-tech/bounce-smart-contracts/blob/main/src/LeveragedToken.sol
interface IBounceLeveragedToken is IERC20 {
    /// @notice Mint LT by depositing base asset (USDC).
    /// @param to Recipient of the minted LT
    /// @param baseAmount Amount of USDC to deposit
    /// @param minOut Minimum LT to receive (slippage protection)
    /// @return ltAmount Amount of LT minted
    function mint(
        address to,
        uint256 baseAmount,
        uint256 minOut
    ) external returns (uint256 ltAmount);

    /// @notice Redeem LT for base asset (USDC). Reverts if insufficient idle USDC.
    /// @param to Recipient of the USDC
    /// @param ltAmount Amount of LT to redeem
    /// @param minBase Minimum USDC to receive
    /// @return baseAmount Amount of USDC returned
    function redeem(
        address to,
        uint256 ltAmount,
        uint256 minBase
    ) external returns (uint256 baseAmount);

    /// @notice Idle USDC available for atomic redeem. Sells must not exceed this amount.
    function baseAssetBalance() external view returns (uint256);

    /// @notice Current exchange rate: USD value per LT unit, scaled to 18 decimals
    function exchangeRate() external view returns (uint256);

    /// @notice Leverage multiplier (2, 3, or 5)
    function targetLeverage() external view returns (uint256);

    /// @notice Whether this is a long LT
    function isLong() external view returns (bool);

    /// @notice Underlying asset symbol (e.g. "HYPE", "ETH")
    function underlyingSymbol() external view returns (string memory);
}
