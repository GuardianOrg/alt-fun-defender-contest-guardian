// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IUniswapV2Factory
/// @notice Subset used by `Bonding.finalizeGraduation` to look up or create
///         the HyperSwap pair that holds the graduated token's LP.
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
