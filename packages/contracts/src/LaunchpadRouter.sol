// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Bonding} from "./Bonding.sol";
import {FRouter} from "./FRouter.sol";
import {ILeveragedToken} from "./interfaces/ILeveragedToken.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";

/// @title LaunchpadRouter
/// @notice Single entry point for users: pay USDC, receive tokens (and vice versa).
/// @dev Handles USDC -> LT mint -> bonding curve buy (or HyperSwap swap post-graduation).
///      Sell path: token -> curve sell or HyperSwap swap -> LT redeem -> USDC.
///
///      EIP-2612 permit variants (`buyWithPermit`, `sellWithPermit`,
///      `createTokenWithPermit`) let a first-time user skip the pre-approve tx:
///      they sign an off-chain permit and the router applies it before pulling
///      funds. Permits are wrapped in `try/catch` to defuse the standard
///      permit-front-run DoS (if someone else submits the sig first, the nonce
///      is consumed but the allowance is already in place).
contract LaunchpadRouter is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    Bonding public bonding;
    IERC20 public usdc;
    IUniswapV2Router02 public hyperswapRouter;

    /// @notice Permit signature payload (EIP-2612).
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

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
        return _createTokenInternal(params, seedUsdcAmount);
    }

    /// @notice Create a new token, applying an EIP-2612 permit on USDC first.
    /// @dev Permit is only consumed if a seed buy is requested. For a pure
    ///      create (no seed buy) the router needs no USDC, so any provided
    ///      permit is ignored.
    function createTokenWithPermit(
        Bonding.LaunchParams calldata params,
        uint256 seedUsdcAmount,
        PermitData calldata p
    ) external nonReentrant returns (address tokenAddr) {
        if (seedUsdcAmount > 0) _tryPermit(address(usdc), msg.sender, p);
        return _createTokenInternal(params, seedUsdcAmount);
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
        return _buyInternal(tokenAddress, usdcAmount, minTokensOut, referrer);
    }

    /// @notice Buy tokens with USDC, applying an EIP-2612 permit on USDC first.
    function buyWithPermit(
        address tokenAddress,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer,
        PermitData calldata p
    ) external nonReentrant returns (uint256 tokensOut) {
        _tryPermit(address(usdc), msg.sender, p);
        return _buyInternal(tokenAddress, usdcAmount, minTokensOut, referrer);
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
        return _sellInternal(tokenAddress, tokenAmount, minUsdcOut);
    }

    /// @notice Sell tokens for USDC, applying an EIP-2612 permit on the token first.
    /// @dev Requires the token to support EIP-2612 (all FERC20s launched by
    ///      this protocol do). For legacy tokens without permit, use `sell`.
    function sellWithPermit(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minUsdcOut,
        PermitData calldata p
    ) external nonReentrant returns (uint256 usdcOut) {
        _tryPermit(tokenAddress, msg.sender, p);
        return _sellInternal(tokenAddress, tokenAmount, minUsdcOut);
    }

    // ─── Internal: Core Flows ────────────────────────────────────────────

    function _createTokenInternal(
        Bonding.LaunchParams calldata params,
        uint256 seedUsdcAmount
    ) internal returns (address tokenAddr) {
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

    function _buyInternal(
        address tokenAddress,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer
    ) internal returns (uint256 tokensOut) {
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

        // Curve buy may be capped if it would have exceeded remaining real supply
        // (e.g. final buy triggering the supply-based graduation). Return any leftover LT
        // to the user as USDC if the redeem succeeds, otherwise forward LT directly.
        uint256 ltLeft = IERC20(lt).balanceOf(address(this));
        if (ltLeft > 0) {
            IERC20(lt).forceApprove(lt, ltLeft);
            try ILeveragedToken(lt).redeem(msg.sender, ltLeft, 0) {
            // refund delivered as USDC
            }
            catch {
                IERC20(lt).safeTransfer(msg.sender, ltLeft);
            }
        }

        if (tokensOut < minTokensOut) revert SlippageExceeded();

        emit Buy(tokenAddress, msg.sender, usdcAmount, tokensOut);

        if (referrer != address(0) && referrer != msg.sender) {
            emit Referred(tokenAddress, msg.sender, referrer, usdcAmount);
        }
    }

    function _sellInternal(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minUsdcOut
    ) internal returns (uint256 usdcOut) {
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

    // ─── Internal: Permit ────────────────────────────────────────────────

    /// @dev Apply an EIP-2612 permit from `owner_` to this router. Swallows
    ///      reverts to defuse the standard permit-front-run DoS: if an
    ///      attacker observes the mempool and submits the same sig first,
    ///      the nonce is consumed but the allowance is already set, so the
    ///      follow-on `transferFrom` still succeeds. If the permit was never
    ///      applied (e.g. bad sig), the subsequent transfer will revert,
    ///      which is the correct behaviour.
    function _tryPermit(address token, address owner_, PermitData calldata p) internal {
        try IERC20Permit(token).permit(owner_, address(this), p.value, p.deadline, p.v, p.r, p.s) {}
        catch {
            // intentional: see natspec
        }
    }

    // ─── Internal: Curve Trades ──────────────────────────────────────────

    function _buyOnCurve(
        address tokenAddress,
        address lt,
        uint256 ltAmount,
        uint256 /* minOut */
    ) internal returns (uint256 tokensOut) {
        FRouter frouter = bonding.router();
        IERC20(lt).forceApprove(address(frouter), ltAmount);
        // Slippage is checked in LaunchpadRouter.buy after the refund path, so pass 0 here.
        // `msg.sender` is preserved across the internal call, so it's the user
        // who invoked `LaunchpadRouter.buy` — passed through to Bonding as the
        // `trader` for the emitted `Trade` event. Router is trusted by Bonding
        // (it's on the `isRouter` allowlist), so this attribution is not
        // spoofable by any other caller.
        (tokensOut,) = bonding.buy(ltAmount, tokenAddress, 0, msg.sender);
    }

    function _sellOnCurve(
        address tokenAddress,
        uint256 tokenAmount
    ) internal returns (uint256 ltReceived) {
        FRouter frouter = bonding.router();
        IERC20(tokenAddress).forceApprove(address(frouter), tokenAmount);
        ltReceived = bonding.sell(tokenAmount, tokenAddress, 0, msg.sender);
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
