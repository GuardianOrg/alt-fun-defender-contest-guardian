// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IUniswapV2Router02 (HyperSwap-compatible subset)
/// @notice ONLY the canonical V2 functions HyperSwap mainnet exposes AND we
///         actually use. Deliberately minimal — see notes below.
/// @dev    HyperSwap's mainnet V2 router (`0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A`)
///         is NOT a vanilla UniswapV2Router02. The dispatch table is missing
///         every canonical swap function — only three FoT-only variants
///         exist, each with a non-standard `address referrer` argument
///         inserted between `to` and `deadline`:
///
///           - `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint,uint,address[],address,address,uint)` — `0xac3893ba`
///           - `swapExactETHForTokensSupportingFeeOnTransferTokens(uint,address[],address,address,uint)`        — `0xb4822be3`
///           - `swapExactTokensForETHSupportingFeeOnTransferTokens(uint,uint,address[],address,address,uint)`   — `0x52aa4c22`
///
///         For this reason the protocol does NOT call `swapExactTokensForTokens`
///         on the router (it would revert with no data — the selector isn't
///         in the dispatch table). All swaps go directly to the pair via
///         `pair.swap(...)`:
///
///           - `Zap._swapOnUniswapV2` for post-grad user trades
///           - `Bonding._pairRebalance` for the hostile-pre-seed defense
///
///         `addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)`
///         IS canonical V2 on HyperSwap (verified selector `0xe8e33700` and a
///         test `eth_call` reaches the `transferFrom` body), so the deposit
///         leg of `Bonding._routerDepositAndDispose` uses it. `factory()` is
///         also canonical and used by `Deploy.s.sol` to derive the V2 factory
///         address from the router constant.
///
///         If you are tempted to add another router method to this interface,
///         FIRST verify the selector is present in the deployed router's
///         bytecode. The full HyperSwap router surface is documented in
///         `packages/contracts/AGENTS.md` "HyperSwap Router non-standard ABI".
interface IUniswapV2Router02 {
    function factory() external view returns (address);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}
