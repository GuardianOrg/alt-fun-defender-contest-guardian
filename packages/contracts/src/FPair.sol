// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFPair} from "./interfaces/IFPair.sol";

/// @title FPair
/// @notice Per-token bonding curve pair. Tracks reserves and holds tokens.
/// @dev Forked from Virtuals Protocol FPair.sol. Only the router may mutate state.
///      reserve0 = token (tokenA), reserve1 = asset (tokenB, virtual at init).
contract FPair is IFPair, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable router;
    address public immutable tokenA;
    address public immutable tokenB;

    struct Pool {
        uint256 reserve0;
        uint256 reserve1;
        uint256 k;
        uint256 lastUpdated;
    }

    Pool private _pool;

    event Mint(uint256 reserve0, uint256 reserve1);
    event Swap(uint256 amount0In, uint256 amount0Out, uint256 amount1In, uint256 amount1Out);

    error OnlyRouter();
    error AlreadyMinted();

    modifier onlyRouter() {
        if (msg.sender != router) revert OnlyRouter();
        _;
    }

    constructor(
        address router_,
        address token0_,
        address token1_
    ) {
        router = router_;
        tokenA = token0_;
        tokenB = token1_;
    }

    function mint(
        uint256 reserve0,
        uint256 reserve1
    ) external onlyRouter returns (bool) {
        if (_pool.lastUpdated != 0) revert AlreadyMinted();
        _pool = Pool({reserve0: reserve0, reserve1: reserve1, k: reserve0 * reserve1, lastUpdated: block.timestamp});
        emit Mint(reserve0, reserve1);
        return true;
    }

    function swap(
        uint256 amount0In,
        uint256 amount0Out,
        uint256 amount1In,
        uint256 amount1Out
    ) external onlyRouter returns (bool) {
        _pool.reserve0 = (_pool.reserve0 + amount0In) - amount0Out;
        _pool.reserve1 = (_pool.reserve1 + amount1In) - amount1Out;
        _pool.lastUpdated = block.timestamp;
        emit Swap(amount0In, amount0Out, amount1In, amount1Out);
        return true;
    }

    function transferAsset(
        address recipient,
        uint256 amount
    ) external onlyRouter {
        IERC20(tokenB).safeTransfer(recipient, amount);
    }

    function transferToken(
        address recipient,
        uint256 amount
    ) external onlyRouter {
        IERC20(tokenA).safeTransfer(recipient, amount);
    }

    function getReserves() external view returns (uint256, uint256) {
        return (_pool.reserve0, _pool.reserve1);
    }

    function kLast() external view returns (uint256) {
        return _pool.k;
    }

    function tokenBalance() external view returns (uint256) {
        return IERC20(tokenA).balanceOf(address(this));
    }

    function assetBalance() external view returns (uint256) {
        return IERC20(tokenB).balanceOf(address(this));
    }
}
