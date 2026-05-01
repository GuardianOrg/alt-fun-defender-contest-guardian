// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IUniswapV2Pair
/// @notice Subset of UniswapV2Pair used for direct-to-pair swaps (`Zap`) and
///         direct-to-pair LP seeding (`Bonding.finalizeGraduation`). The
///         HyperSwap V2 deployment we target has no token-to-token swap on its
///         router, and direct seeding is also brick-proof against a
///         front-runner dust-seeding the pair (non-zero reserves) between
///         phases.
interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external;

    /// @notice Mint LP tokens to `to`. Caller must have transferred input
    ///         tokens to this pair first (UniswapV2 `transfer → mint` pattern).
    function mint(
        address to
    ) external returns (uint256 liquidity);
}
