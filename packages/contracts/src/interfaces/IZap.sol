// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IZap
/// @notice Surface of `Zap` consumed by `BotFeeRouter`. Decoupled so the
///         router does not pull in `Zap`'s upgrade/UUPS dependencies and
///         tests can swap in a mock.
interface IZap {
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function buy(
        address tokenAddress,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer
    ) external returns (uint256 tokensOut);

    function sell(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minUsdcOut
    ) external returns (uint256 usdcOut);
}
