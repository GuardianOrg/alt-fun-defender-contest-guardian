// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IUniswapV2Pair
/// @notice Subset of the standard UniswapV2Pair interface used by `Zap` for
///         direct-to-pair swaps (bypassing the router on HyperEVM, where the
///         deployed HyperSwap V2 router has no token-to-token swap function).
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
}
