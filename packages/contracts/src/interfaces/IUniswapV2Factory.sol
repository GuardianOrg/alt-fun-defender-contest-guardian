// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IUniswapV2Factory
/// @notice Subset of the standard UniswapV2Factory interface used by
///         `Bonding.finalizeGraduation` to look up or create the HyperSwap pair
///         that will hold the graduated token's LP. We resolve the factory via
///         `IUniswapV2Router02.factory()` rather than hard-coding it so the
///         same code works against any V2-compatible deployment.
interface IUniswapV2Factory {
    function getPair(
        address tokenA,
        address tokenB
    ) external view returns (address pair);
    function createPair(
        address tokenA,
        address tokenB
    ) external returns (address pair);
}
