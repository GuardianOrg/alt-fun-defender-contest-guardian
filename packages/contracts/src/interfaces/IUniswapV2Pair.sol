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

    /// @notice Fee-aware output quote for swapping `amountIn` of `tokenIn`.
    ///         Reads the pair's live per-token fee, so callers never have to
    ///         assume a fee rate that could diverge from the pair's K-check.
    function getAmountOut(
        uint256 amountIn,
        address tokenIn
    ) external view returns (uint256 amountOut);

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

    /// @notice Force the pair to send any token balance in excess of stored
    ///         `reserve0/reserve1` to `to`. Used by `Bonding.finalizeGraduation`
    ///         to sweep pure-donation pre-seeds (raw `transfer` to the pair
    ///         without `mint`) before the rebalance, so donated tokens don't
    ///         pollute the post-swap ratio computation. Pure-mint pre-seeds
    ///         leave `balance == reserves` and are unaffected.
    function skim(
        address to
    ) external;

    /// @notice ERC20 LP total supply / balance. Used by tests to assert
    ///         attacker-LP-share invariants; production reads `mint`'s return.
    function totalSupply() external view returns (uint256);
    function balanceOf(
        address account
    ) external view returns (uint256);
}
