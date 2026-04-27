// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IUniswapV2Pair
/// @notice Subset of the standard UniswapV2Pair interface used for direct-to-pair
///         swaps (`Zap`) and direct-to-pair LP seeding (`Bonding.finalizeGraduation`).
///         Bypassing the router is required because HyperSwap V2's router has no
///         token-to-token swap function, and is also the safest path for graduation
///         (immune to a front-runner pre-seeding the pair with non-zero reserves).
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

    /// @notice Mint LP tokens to `to`. The caller is expected to have transferred
    ///         the input tokens to this pair before calling.
    /// @dev Standard UniswapV2 pattern: `transfer → pair.mint`. The pair derives
    ///      the deposited amounts from `balanceOf(address(this)) - reserves` and
    ///      mints proportionally. Works for both initial liquidity (any non-zero
    ///      deposit) and subsequent adds (proportional to existing reserves).
    function mint(
        address to
    ) external returns (uint256 liquidity);
}
