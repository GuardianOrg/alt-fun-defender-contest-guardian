// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FFactory} from "./FFactory.sol";
import {IFPair} from "./interfaces/IFPair.sol";

/// @title FRouter
/// @notice Executes buy/sell trades on bonding curve pairs using constant-product AMM math.
/// @dev Supports per-token LT pairing. No fees are charged at this layer — protocol fees
///      are collected in USDC by `LaunchpadRouter` and routed to `FeeVault`.
///
///      Supports "virtual" token reserves, where `reserve0` in the pair can exceed the
///      amount of real tokens held. This is used by the launchpad so the curve extends
///      beyond the sellable supply, enabling dynamic LP seeding at graduation.
contract FRouter is Initializable, AccessControlUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");

    FFactory public factory;

    error ZeroAddress();
    error ZeroAmount();
    error PairNotFound();

    function initialize(
        address factory_
    ) external initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        factory = FFactory(factory_);
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

        IFPair pair = IFPair(pairAddr);
        (uint256 reserveToken, uint256 reserveAsset) = pair.getReserves();
        uint256 k = pair.kLast();

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
        IFPair(pairAddr).mint(virtualReserveToken, reserveAsset);
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
    ) external onlyRole(BONDING_ROLE) nonReentrant returns (uint256 amountInUsed, uint256 tokensOut) {
        if (amountIn == 0) revert ZeroAmount();

        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);

        (amountInUsed, tokensOut) = _computeBuy(pairAddr, amountIn);

        IERC20(asset).safeTransferFrom(to, pairAddr, amountInUsed);

        IFPair(pairAddr).transferToken(to, tokensOut);
        IFPair(pairAddr).swap(0, tokensOut, amountInUsed, 0);
    }

    /// @dev Compute buy amounts, capping `tokensOut` at the pair's real token balance.
    ///      When capped, `amountInUsed` is back-calculated from the invariant (rounded up).
    function _computeBuy(
        address pairAddr,
        uint256 amountIn
    ) internal view returns (uint256 amountInUsed, uint256 tokensOut) {
        IFPair pair = IFPair(pairAddr);
        (uint256 r0, uint256 r1) = pair.getReserves();
        uint256 k = pair.kLast();

        amountInUsed = amountIn;

        uint256 newR1 = r1 + amountInUsed;
        tokensOut = r0 - (k / newR1);

        uint256 realBalance = pair.tokenBalance();
        if (tokensOut > realBalance) {
            tokensOut = realBalance;
            uint256 cappedR0 = r0 - tokensOut;
            uint256 cappedR1 = cappedR0 == 0 ? newR1 : (k + cappedR0 - 1) / cappedR0;
            amountInUsed = cappedR1 - r1;
        }
    }

    /// @notice Execute a sell: tokens in -> LT out. No fee at this layer.
    /// @return tokensIn The tokens that entered the curve
    /// @return assetOut The LT amount sent to the seller
    function sell(
        uint256 amountIn,
        address token,
        address to
    ) external onlyRole(BONDING_ROLE) nonReentrant returns (uint256 tokensIn, uint256 assetOut) {
        if (amountIn == 0) revert ZeroAmount();

        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        tokensIn = amountIn;

        IERC20(token).safeTransferFrom(to, pairAddr, amountIn);

        assetOut = getAmountOut(token, false, amountIn);

        IFPair(pairAddr).transferAsset(to, assetOut);

        IFPair(pairAddr).swap(amountIn, 0, 0, assetOut);
    }

    /// @notice Drain real LT balance from a pair (called during graduation).
    /// @return amount The LT amount transferred to the caller (Bonding)
    function graduate(
        address token
    ) external onlyRole(BONDING_ROLE) nonReentrant returns (uint256 amount) {
        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        amount = IFPair(pairAddr).assetBalance();
        IFPair(pairAddr).transferAsset(msg.sender, amount);
    }
}
