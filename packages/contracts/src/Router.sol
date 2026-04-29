// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Factory} from "./Factory.sol";
import {IPair} from "./interfaces/IPair.sol";

/// @title Router
/// @notice Executes buy/sell trades on bonding curve pairs using constant-product AMM math.
/// @dev Supports per-token LT pairing. No fees are charged at this layer — protocol fees
///      are collected in USDC by `Zap` and routed to `FeeVault`.
///
///      Supports "virtual" token reserves, where `tokenReserve` in the pair can exceed
///      the amount of real tokens held. This is used by the launchpad so the curve
///      extends beyond the sellable supply, enabling dynamic LP seeding at graduation.
///
///      Trust assumption: this contract does not apply its own reentrancy guard. All
///      state-mutating entry points are gated by `BONDING_ROLE`, and the canonical caller
///      (`Bonding`) wraps every external trade in its own `nonReentrant` modifier. Granting
///      `BONDING_ROLE` to any contract that does not enforce non-reentrancy on the calling
///      path would be unsafe.
contract Router is Initializable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");

    Factory public factory;

    error ZeroAddress();
    error ZeroAmount();
    error PairNotFound();

    function initialize(
        address factory_
    ) external initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        factory = Factory(factory_);
    }

    /// @notice Resolve the LT address for a given token
    function assetTokenFor(
        address token
    ) public view returns (address) {
        return factory.ltFor(token);
    }

    /// @notice Compute the output amount for a given input using the constant-product formula.
    function getAmountOut(
        address token,
        bool isBuy,
        uint256 amountIn
    ) public view returns (uint256) {
        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        if (pairAddr == address(0)) revert PairNotFound();

        IPair pair = IPair(pairAddr);
        (uint256 reserveToken, uint256 reserveAsset) = pair.getReserves();
        uint256 k = pair.k();

        if (isBuy) {
            uint256 newReserveAsset = reserveAsset + amountIn;
            uint256 newReserveToken = k / newReserveAsset;
            return reserveToken - newReserveToken;
        } else {
            uint256 newReserveToken = reserveToken + amountIn;
            uint256 newReserveAsset = k / newReserveToken;
            return reserveAsset - newReserveAsset;
        }
    }

    /// @notice Seed a pair with an initial token reserve and virtual LT reserve.
    /// @param token              Token to seed
    /// @param virtualReserveToken Token reserve value stored in the pair (defines K).
    ///                            May exceed `realTokenAmount`, creating a virtual reserve.
    /// @param realTokenAmount    Actual tokens transferred to the pair (what can be sold).
    /// @param reserveAsset       Virtual LT reserve (no real LT transferred at init).
    function addInitialLiquidity(
        address token,
        uint256 virtualReserveToken,
        uint256 realTokenAmount,
        uint256 reserveAsset
    ) external onlyRole(BONDING_ROLE) {
        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        if (pairAddr == address(0)) revert PairNotFound();

        IERC20(token).safeTransferFrom(msg.sender, pairAddr, realTokenAmount);
        IPair(pairAddr).mint(virtualReserveToken, reserveAsset);
    }

    /// @notice Execute a buy: LT in -> tokens out. No fee at this layer.
    /// @dev If the computed `tokensOut` would exceed the pair's real token balance, the buy is
    ///      capped at the real balance and `amountInUsed` is back-calculated. The caller's
    ///      approval covers `amountIn`, but only `amountInUsed` worth of LT is pulled.
    /// @return amountInUsed The LT actually consumed (≤ `amountIn`).
    /// @return tokensOut    The tokens sent to the buyer.
    function buy(
        uint256 amountIn,
        address token,
        address to
    ) external onlyRole(BONDING_ROLE) returns (uint256 amountInUsed, uint256 tokensOut) {
        if (amountIn == 0) revert ZeroAmount();

        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);

        (amountInUsed, tokensOut) = _computeBuy(pairAddr, amountIn);

        IERC20(asset).safeTransferFrom(to, pairAddr, amountInUsed);

        IPair(pairAddr).transferToken(to, tokensOut);
        IPair(pairAddr).swap(0, tokensOut, amountInUsed, 0);
    }

    /// @dev Compute buy amounts, capping `tokensOut` at the pair's real token balance.
    ///      When capped, `amountInUsed` is back-calculated from the invariant (rounded up).
    function _computeBuy(
        address pairAddr,
        uint256 amountIn
    ) internal view returns (uint256 amountInUsed, uint256 tokensOut) {
        IPair pair = IPair(pairAddr);
        (uint256 reserveToken, uint256 reserveAsset) = pair.getReserves();
        uint256 k = pair.k();

        amountInUsed = amountIn;

        uint256 newReserveAsset = reserveAsset + amountInUsed;
        tokensOut = reserveToken - (k / newReserveAsset);

        uint256 realBalance = pair.tokenBalance();
        if (tokensOut > realBalance) {
            tokensOut = realBalance;
            uint256 cappedReserveToken = reserveToken - tokensOut;
            uint256 cappedReserveAsset =
                cappedReserveToken == 0 ? newReserveAsset : (k + cappedReserveToken - 1) / cappedReserveToken;
            amountInUsed = cappedReserveAsset - reserveAsset;
        }
    }

    /// @notice Execute a sell: tokens in -> LT out. No fee at this layer.
    /// @return tokensIn The tokens that entered the curve
    /// @return assetOut The LT amount sent to the seller
    function sell(
        uint256 amountIn,
        address token,
        address to
    ) external onlyRole(BONDING_ROLE) returns (uint256 tokensIn, uint256 assetOut) {
        if (amountIn == 0) revert ZeroAmount();

        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        if (pairAddr == address(0)) revert PairNotFound();
        tokensIn = amountIn;

        IERC20(token).safeTransferFrom(to, pairAddr, amountIn);

        assetOut = _computeSell(pairAddr, amountIn);

        IPair(pairAddr).transferAsset(to, assetOut);

        IPair(pairAddr).swap(amountIn, 0, 0, assetOut);
    }

    /// @dev Compute sell output for a given pair and input amount.
    function _computeSell(
        address pairAddr,
        uint256 amountIn
    ) internal view returns (uint256 assetOut) {
        IPair pair = IPair(pairAddr);
        (uint256 reserveToken, uint256 reserveAsset) = pair.getReserves();
        uint256 k = pair.k();

        uint256 newReserveToken = reserveToken + amountIn;
        assetOut = reserveAsset - (k / newReserveToken);
    }

    /// @notice Drain real LT balance from a pair (called during graduation).
    /// @return amount The LT amount transferred to the caller (Bonding)
    function graduate(
        address token
    ) external onlyRole(BONDING_ROLE) returns (uint256 amount) {
        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        amount = IPair(pairAddr).assetBalance();
        IPair(pairAddr).transferAsset(msg.sender, amount);
    }
}
