// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Bonding} from "./Bonding.sol";
import {FRouter} from "./FRouter.sol";
import {ILeveragedToken} from "./interfaces/ILeveragedToken.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";

/// @title LaunchpadRouter
/// @notice Single entry point for users: pay USDC, receive tokens (and vice versa).
/// @dev Handles USDC -> LT mint -> bonding curve buy (or HyperSwap swap post-graduation).
///      Sell path: token -> curve sell or HyperSwap swap -> LT redeem -> USDC.
contract LaunchpadRouter is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    Bonding public bonding;
    IERC20 public usdc;
    IUniswapV2Router02 public hyperswapRouter;

    event Buy(address indexed token, address indexed buyer, uint256 usdcIn, uint256 tokensOut);
    event Sell(address indexed token, address indexed seller, uint256 tokensIn, uint256 usdcOut);
    event Referred(address indexed token, address indexed trader, address indexed referrer, uint256 usdcAmount);
    event TokenCreated(address indexed token, address indexed creator, address ltAddress);

    error InvalidInput();
    error SlippageExceeded();
    error ZeroAddress();

    event BondingUpdated(address indexed bonding);
    event HyperswapRouterUpdated(address indexed hyperswapRouter);

    function initialize(
        address bonding_,
        address usdc_,
        address hyperswapRouter_
    ) external initializer {
        if (bonding_ == address(0) || usdc_ == address(0) || hyperswapRouter_ == address(0)) revert ZeroAddress();
        __Ownable_init(msg.sender);
        bonding = Bonding(bonding_);
        usdc = IERC20(usdc_);
        hyperswapRouter = IUniswapV2Router02(hyperswapRouter_);
    }

    /// @notice Create a new token on the bonding curve
    /// @param params Launch parameters (name, ticker, description, image, urls, ltAddress, purchaseAmount=0)
    /// @param seedUsdcAmount USDC amount for seed buy (0 = no seed buy)
    function createToken(
        Bonding.LaunchParams calldata params,
        uint256 seedUsdcAmount
    ) external nonReentrant returns (address tokenAddr) {
        address lt = params.ltAddress;
        if (lt == address(0)) revert InvalidInput();

        uint256 ltForSeed = 0;
        if (seedUsdcAmount > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), seedUsdcAmount);
            usdc.forceApprove(lt, seedUsdcAmount);
            ltForSeed = ILeveragedToken(lt).mint(address(this), seedUsdcAmount, 0);
            IERC20(lt).forceApprove(address(bonding), ltForSeed);
        }

        Bonding.LaunchParams memory launchParams = Bonding.LaunchParams({
            name: params.name,
            ticker: params.ticker,
            description: params.description,
            image: params.image,
            urls: params.urls,
            ltAddress: lt,
            purchaseAmount: ltForSeed
        });

        (tokenAddr,,) = bonding.launch(launchParams, msg.sender);
        emit TokenCreated(tokenAddr, msg.sender, lt);
    }

    /// @notice Buy tokens with USDC
    /// @param tokenAddress Token to buy
    /// @param usdcAmount USDC to spend
    /// @param minTokensOut Minimum tokens to receive
    /// @param referrer Referrer address (address(0) if none)
    function buy(
        address tokenAddress,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer
    ) external nonReentrant returns (uint256 tokensOut) {
        if (usdcAmount == 0) revert InvalidInput();

        (,,, address lt,,,,) = bonding.tokenInfo(tokenAddress);

        // USDC -> LT
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdc.forceApprove(lt, usdcAmount);
        uint256 ltAmount = ILeveragedToken(lt).mint(address(this), usdcAmount, 0);

        if (bonding.isGraduated(tokenAddress)) {
            tokensOut = _buyOnHyperswap(tokenAddress, lt, ltAmount, minTokensOut);
        } else {
            tokensOut = _buyOnCurve(tokenAddress, lt, ltAmount, minTokensOut);
        }

        IERC20(tokenAddress).safeTransfer(msg.sender, tokensOut);

        if (tokensOut < minTokensOut) revert SlippageExceeded();

        emit Buy(tokenAddress, msg.sender, usdcAmount, tokensOut);

        if (referrer != address(0) && referrer != msg.sender) {
            emit Referred(tokenAddress, msg.sender, referrer, usdcAmount);
        }
    }

    /// @notice Sell tokens for USDC
    /// @param tokenAddress Token to sell
    /// @param tokenAmount Amount of tokens to sell
    /// @param minUsdcOut Minimum USDC to receive
    function sell(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minUsdcOut
    ) external nonReentrant returns (uint256 usdcOut) {
        if (tokenAmount == 0) revert InvalidInput();

        (,,, address lt,,,,) = bonding.tokenInfo(tokenAddress);

        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), tokenAmount);

        uint256 ltReceived;
        if (bonding.isGraduated(tokenAddress)) {
            ltReceived = _sellOnHyperswap(tokenAddress, lt, tokenAmount);
        } else {
            ltReceived = _sellOnCurve(tokenAddress, tokenAmount);
        }

        // LT -> USDC
        IERC20(lt).forceApprove(lt, ltReceived);
        usdcOut = ILeveragedToken(lt).redeem(msg.sender, ltReceived, minUsdcOut);

        if (usdcOut < minUsdcOut) revert SlippageExceeded();

        emit Sell(tokenAddress, msg.sender, tokenAmount, usdcOut);
    }

    // ─── Internal: Curve Trades ──────────────────────────────────────────

    function _buyOnCurve(
        address tokenAddress,
        address lt,
        uint256 ltAmount,
        uint256 minOut
    ) internal returns (uint256 tokensOut) {
        FRouter frouter = bonding.router();
        IERC20(lt).forceApprove(address(frouter), ltAmount);
        tokensOut = bonding.buy(ltAmount, tokenAddress, minOut);
    }

    function _sellOnCurve(
        address tokenAddress,
        uint256 tokenAmount
    ) internal returns (uint256 ltReceived) {
        FRouter frouter = bonding.router();
        IERC20(tokenAddress).forceApprove(address(frouter), tokenAmount);
        ltReceived = bonding.sell(tokenAmount, tokenAddress, 0);
    }

    // ─── Internal: HyperSwap Trades ─────────────────────────────────────

    function _buyOnHyperswap(
        address tokenAddress,
        address lt,
        uint256 ltAmount,
        uint256 minOut
    ) internal returns (uint256 tokensOut) {
        IERC20(lt).forceApprove(address(hyperswapRouter), ltAmount);
        address[] memory path = new address[](2);
        path[0] = lt;
        path[1] = tokenAddress;
        uint256[] memory amounts =
            hyperswapRouter.swapExactTokensForTokens(ltAmount, minOut, path, address(this), block.timestamp);
        tokensOut = amounts[amounts.length - 1];
    }

    function _sellOnHyperswap(
        address tokenAddress,
        address lt,
        uint256 tokenAmount
    ) internal returns (uint256 ltReceived) {
        IERC20(tokenAddress).forceApprove(address(hyperswapRouter), tokenAmount);
        address[] memory path = new address[](2);
        path[0] = tokenAddress;
        path[1] = lt;
        uint256[] memory amounts =
            hyperswapRouter.swapExactTokensForTokens(tokenAmount, 0, path, address(this), block.timestamp);
        ltReceived = amounts[amounts.length - 1];
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function setBonding(
        address bonding_
    ) external onlyOwner {
        if (bonding_ == address(0)) revert ZeroAddress();
        bonding = Bonding(bonding_);
        emit BondingUpdated(bonding_);
    }

    function setHyperswapRouter(
        address hyperswapRouter_
    ) external onlyOwner {
        if (hyperswapRouter_ == address(0)) revert ZeroAddress();
        hyperswapRouter = IUniswapV2Router02(hyperswapRouter_);
        emit HyperswapRouterUpdated(hyperswapRouter_);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
