// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPair} from "./interfaces/IPair.sol";

/// @title Pair
/// @notice Per-token bonding curve pair. Tracks reserves and holds tokens.
/// @dev Forked from Virtuals Protocol's `FPair.sol`. Only the router may mutate state.
///      Reserves are NOT sorted by address (UniswapV2 convention) — the launched
///      token is always `launchedToken` and its reserve is `tokenReserve`; the
///      paired LT is always `assetToken` and its reserve is `assetReserve`
///      (virtual at init). The naming kills the confusion at the source: any
///      future code that touches `Pair` doesn't have to remember a non-V2
///      ordering convention.
contract Pair is IPair {
    using SafeERC20 for IERC20;

    address public immutable router;
    address public immutable launchedToken;
    address public immutable assetToken;

    struct Pool {
        uint256 tokenReserve;
        uint256 assetReserve;
        uint256 k;
        uint256 lastUpdated;
    }

    Pool private _pool;

    event Mint(uint256 tokenReserve, uint256 assetReserve);
    event Swap(uint256 tokenIn, uint256 tokenOut, uint256 assetIn, uint256 assetOut);

    error OnlyRouter();
    error AlreadyMinted();
    error KInvariantViolated();

    modifier onlyRouter() {
        if (msg.sender != router) revert OnlyRouter();
        _;
    }

    constructor(
        address router_,
        address launchedToken_,
        address assetToken_
    ) {
        router = router_;
        launchedToken = launchedToken_;
        assetToken = assetToken_;
    }

    function mint(
        uint256 tokenReserve,
        uint256 assetReserve
    ) external onlyRouter returns (bool) {
        if (_pool.lastUpdated != 0) revert AlreadyMinted();
        _pool = Pool({
            tokenReserve: tokenReserve,
            assetReserve: assetReserve,
            k: tokenReserve * assetReserve,
            lastUpdated: block.timestamp
        });
        emit Mint(tokenReserve, assetReserve);
        return true;
    }

    function swap(
        uint256 tokenIn,
        uint256 tokenOut,
        uint256 assetIn,
        uint256 assetOut
    ) external onlyRouter returns (bool) {
        uint256 newTokenReserve = (_pool.tokenReserve + tokenIn) - tokenOut;
        uint256 newAssetReserve = (_pool.assetReserve + assetIn) - assetOut;
        if ((newTokenReserve + 1) * (newAssetReserve + 1) < _pool.k) revert KInvariantViolated();

        _pool.tokenReserve = newTokenReserve;
        _pool.assetReserve = newAssetReserve;
        _pool.lastUpdated = block.timestamp;
        emit Swap(tokenIn, tokenOut, assetIn, assetOut);
        return true;
    }

    function transferAsset(
        address recipient,
        uint256 amount
    ) external onlyRouter {
        IERC20(assetToken).safeTransfer(recipient, amount);
    }

    function transferToken(
        address recipient,
        uint256 amount
    ) external onlyRouter {
        IERC20(launchedToken).safeTransfer(recipient, amount);
    }

    function getReserves() external view returns (uint256, uint256) {
        return (_pool.tokenReserve, _pool.assetReserve);
    }

    function k() external view returns (uint256) {
        return _pool.k;
    }

    function tokenBalance() external view returns (uint256) {
        return IERC20(launchedToken).balanceOf(address(this));
    }

    function assetBalance() external view returns (uint256) {
        return IERC20(assetToken).balanceOf(address(this));
    }
}
