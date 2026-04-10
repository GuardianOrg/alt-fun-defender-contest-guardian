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
/// @dev Supports per-token LT pairing. Fees in basis points (1 bp = 0.01%).
///      Buy: deducts fee from amountIn, sends net to pair, returns tokens.
///      Sell: takes tokens into pair, deducts fee from amountOut, returns net LT.
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

    /// @notice Resolve the LT address for a given memecoin
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

    /// @notice Seed a pair with initial token supply and virtual LT reserve.
    function addInitialLiquidity(
        address token,
        uint256 tokenAmount,
        uint256 assetAmount
    ) external onlyRole(BONDING_ROLE) {
        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        if (pairAddr == address(0)) revert PairNotFound();

        IERC20(token).safeTransferFrom(msg.sender, pairAddr, tokenAmount);
        IFPair(pairAddr).mint(tokenAmount, assetAmount);
    }

    /// @notice Execute a buy: LT in -> tokens out. Fee deducted from input.
    /// @return netAssetIn The LT amount that entered the curve (after fee)
    /// @return tokensOut The tokens sent to the buyer
    function buy(
        uint256 amountIn,
        address token,
        address to
    ) external onlyRole(BONDING_ROLE) nonReentrant returns (uint256 netAssetIn, uint256 tokensOut) {
        if (amountIn == 0) revert ZeroAmount();

        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        address feeTo = factory.feeTo();
        uint256 fee = (factory.buyTax() * amountIn) / 10_000;
        netAssetIn = amountIn - fee;

        IERC20(asset).safeTransferFrom(to, pairAddr, netAssetIn);
        if (fee > 0) {
            IERC20(asset).safeTransferFrom(to, feeTo, fee);
        }

        tokensOut = getAmountOut(token, true, netAssetIn);
        IFPair(pairAddr).transferToken(to, tokensOut);
        IFPair(pairAddr).swap(0, tokensOut, netAssetIn, 0);
    }

    /// @notice Execute a sell: tokens in -> LT out. Fee deducted from output.
    /// @return tokensIn The tokens that entered the curve
    /// @return netAssetOut The LT amount sent to the seller (after fee)
    function sell(
        uint256 amountIn,
        address token,
        address to
    ) external onlyRole(BONDING_ROLE) nonReentrant returns (uint256 tokensIn, uint256 netAssetOut) {
        if (amountIn == 0) revert ZeroAmount();

        address asset = assetTokenFor(token);
        address pairAddr = factory.getPair(token, asset);
        tokensIn = amountIn;

        IERC20(token).safeTransferFrom(to, pairAddr, amountIn);

        uint256 grossOut = getAmountOut(token, false, amountIn);
        uint256 fee = (factory.sellTax() * grossOut) / 10_000;
        netAssetOut = grossOut - fee;
        address feeTo = factory.feeTo();

        IFPair(pairAddr).transferAsset(to, netAssetOut);
        if (fee > 0) {
            IFPair(pairAddr).transferAsset(feeTo, fee);
        }

        IFPair(pairAddr).swap(amountIn, 0, 0, grossOut);
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
