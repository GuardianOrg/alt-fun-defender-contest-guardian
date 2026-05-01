// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Factory} from "./Factory.sol";
import {IPair} from "./interfaces/IPair.sol";

/// @title Router
/// @notice AMM math for bonding-curve pairs. No fees here — `Zap` handles fees.
/// @dev Supports virtual token reserves (curve extends beyond sellable supply,
///      enabling zero-gap LP seeding at graduation).
///
///      No reentrancy guard: all entry points are gated by `BONDING_ROLE`, and
///      `Bonding` wraps every trade in `nonReentrant`. Granting `BONDING_ROLE`
///      to any caller that doesn't enforce non-reentrancy would be unsafe.
contract Router is Initializable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");

    Factory public factory;

    error ZeroAddress();
    error ZeroAmount();
    error PairNotFound();
    error OverflowCapDegenerate();

    function initialize(
        address factory_
    ) external initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        factory = Factory(factory_);
    }

    function assetTokenFor(
        address token
    ) public view returns (address) {
        return factory.ltFor(token);
    }

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

    /// @param virtualReserveToken Token reserve stored in the pair (defines K);
    ///                            may exceed `realTokenAmount`.
    /// @param realTokenAmount    Tokens actually transferred (sellable supply).
    /// @param reserveAsset       Virtual LT reserve (no real LT moved here).
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

    /// @notice LT in → tokens out. Caps `tokensOut` at the pair's real balance
    ///         and back-calculates `amountInUsed` so the last buy can't exceed
    ///         remaining supply (the leftover LT stays with the caller).
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

    /// @dev Capped: `amountInUsed` is back-calculated from the K invariant
    ///      (rounded up so the curve never under-charges).
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
            if (cappedReserveToken == 0) revert OverflowCapDegenerate();
            uint256 cappedReserveAsset = (k + cappedReserveToken - 1) / cappedReserveToken;
            amountInUsed = cappedReserveAsset - reserveAsset;
        }
    }

    /// @notice Tokens in → LT out.
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

    /// @notice Transfer exactly `amount` of LT out of the pair to the caller.
    ///         Called by `Bonding._prepareGraduationLiquidity` during graduation
    ///         with `amount = stored assetReserve - virtualLtReserve` (i.e. the
    ///         real LT raised by the curve, excluding the virtual seed).
    /// @dev    Donation-resistant: passing an explicit `amount` instead of
    ///         draining `assetBalance()` ensures any LT that was donated
    ///         directly to the pair via `IERC20.transfer` is left behind and
    ///         excluded from LP seeding. The leftover is effectively burned —
    ///         after graduation, only `Router` can call `Pair.transferAsset`,
    ///         and `Router` has no code path to drain a graduated pair.
    function graduate(
        address token,
        uint256 amount
    ) external onlyRole(BONDING_ROLE) {
        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        IPair(pairAddr).transferAsset(msg.sender, amount);
    }
}
