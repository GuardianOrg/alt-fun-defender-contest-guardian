// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Bonding} from "./Bonding.sol";
import {Router} from "./Router.sol";
import {FeeVault} from "./FeeVault.sol";
import {IBounceLeveragedToken} from "./interfaces/IBounceLeveragedToken.sol";
import {IUniswapV2Pair} from "./interfaces/IUniswapV2Pair.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";

/// @title Zap
/// @notice User-facing entry point: pay USDC, receive tokens (and vice versa).
/// @dev Buy path: USDC → LT mint → curve buy (or V2 swap post-grad).
///      Sell path: token → curve sell or V2 swap → LT redeem → USDC.
///      Fee layer: every buy/sell skims USDC and forwards it to `FeeVault`. No
///      fees live on `Bonding`, `Router`, or `Factory`.
///      Permit variants apply an EIP-2612 sig before pulling funds; wrapped in
///      `try/catch` to defuse the standard permit-front-run DoS.
contract Zap is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOM = 10_000;

    /// @dev Owner-fat-finger guard. 2% hard ceiling on each side.
    uint256 public constant MAX_FEE_BPS = 200;

    /// @dev BounceTech `mint`/`redeem` floor. Below this the LT reverts with
    ///      undecodable selector `0x05eb05ac`; pre-checked so users see
    ///      `BelowMinAmount` instead. Real USDC (6dp) — `$10`.
    uint256 public constant MIN_USDC_AMOUNT = 10e6;

    Bonding public bonding;
    IERC20 public usdc;
    IUniswapV2Router02 public uniswapV2Router;
    FeeVault public feeVault;

    uint256 public buyFeeBps;
    uint256 public sellFeeBps;
    /// @notice Share of total fee routed to creator (bps); remainder is protocol.
    uint256 public creatorFeeBps;

    /// @dev Storage gap → 50 slots total. Append new state variables before
    ///      this gap and shrink the length to match.
    uint256[43] private __gap;

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
    event TokenCreated(address indexed token, address indexed creator, address indexed ltAddress);
    event BondingUpdated(address indexed bonding);
    event UniswapV2RouterUpdated(address indexed uniswapV2Router);
    event FeeVaultUpdated(address indexed feeVault);
    event FeesUpdated(uint256 buyFeeBps, uint256 sellFeeBps, uint256 creatorFeeBps);
    /// @dev Buy's leftover-LT redeem reverted (typically below `MIN_USDC_AMOUNT`)
    ///      and the LT was returned as-is. Frontend uses this to surface "you
    ///      got LT instead of USDC because the leftover was below the $10 floor".
    event LeftoverLTReturned(address indexed user, uint256 amount);

    error InvalidInput();
    error SlippageExceeded();
    error ZeroAddress();
    error InvalidFee();
    error VaultNotConfigured();
    error BondingNotConfigured();
    error TokenIsGraduating();
    /// @dev Caught upfront so unknown tokens revert before any USDC moves
    ///      (otherwise the failure surfaces deep in `SafeERC20` with an opaque error).
    error TokenNotTrading();
    /// @dev Mirrors the BounceTech LT `mint`/`redeem` floor so users see a
    ///      clean error instead of an undecodable LT revert.
    error BelowMinAmount();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address bonding_,
        address usdc_,
        address uniswapV2Router_,
        address feeVault_,
        uint256 buyFeeBps_,
        uint256 sellFeeBps_,
        uint256 creatorFeeBps_
    ) external initializer {
        if (bonding_ == address(0) || usdc_ == address(0) || uniswapV2Router_ == address(0) || feeVault_ == address(0)) revert ZeroAddress();
        if (buyFeeBps_ > MAX_FEE_BPS || sellFeeBps_ > MAX_FEE_BPS || creatorFeeBps_ > BPS_DENOM) revert InvalidFee();
        __Ownable_init(msg.sender);
        bonding = Bonding(bonding_);
        usdc = IERC20(usdc_);
        uniswapV2Router = IUniswapV2Router02(uniswapV2Router_);
        feeVault = FeeVault(feeVault_);
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        creatorFeeBps = creatorFeeBps_;
    }

    /// @param seedUsdcAmount USDC for seed buy (0 = no seed). Routed through
    ///                       `_buyInternal` so it inherits the standard
    ///                       fee/refund handling and emits `Buy`.
    function createToken(
        Bonding.LaunchParams calldata params,
        uint256 seedUsdcAmount
    ) external nonReentrant returns (address tokenAddr) {
        return _createTokenInternal(params, seedUsdcAmount);
    }

    /// @dev Permit is only consumed when a seed buy is requested.
    function createTokenWithPermit(
        Bonding.LaunchParams calldata params,
        uint256 seedUsdcAmount,
        PermitData calldata p
    ) external nonReentrant returns (address tokenAddr) {
        if (seedUsdcAmount > 0) _tryPermit(address(usdc), msg.sender, p);
        return _createTokenInternal(params, seedUsdcAmount);
    }

    function buy(
        address tokenAddress,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer
    ) external nonReentrant returns (uint256 tokensOut) {
        return _buyInternal(tokenAddress, usdcAmount, minTokensOut, referrer);
    }

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

    function sell(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minUsdcOut
    ) external nonReentrant returns (uint256 usdcOut) {
        return _sellInternal(tokenAddress, tokenAmount, minUsdcOut);
    }

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
        if (params.ltAddress == address(0)) revert InvalidInput();

        (tokenAddr,) = bonding.launch(params, msg.sender);
        emit TokenCreated(tokenAddr, msg.sender, params.ltAddress);

        // `minTokensOut = 0` is intentional: a seed buy executes in the same tx
        // as the launch, so there's nothing for slippage to protect against.
        if (seedUsdcAmount > 0) {
            _buyInternal(tokenAddr, seedUsdcAmount, 0, address(0));
        }
    }

    function _buyInternal(
        address tokenAddress,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer
    ) internal returns (uint256 tokensOut) {
        if (usdcAmount == 0) revert InvalidInput();
        if (tokenAddress == address(0)) revert InvalidInput();
        if (usdcAmount < MIN_USDC_AMOUNT) revert BelowMinAmount();
        if (bonding.creatorOf(tokenAddress) == address(0)) revert TokenNotTrading();
        if (bonding.isGraduating(tokenAddress)) revert TokenIsGraduating();

        uint256 amountInUsed;
        uint256 actualFee;
        (tokensOut, amountInUsed, actualFee) = _executeBuy(tokenAddress, usdcAmount);

        if (tokensOut < minTokensOut) revert SlippageExceeded();

        if (actualFee > 0) {
            _accrueFee(tokenAddress, bonding.creatorOf(tokenAddress), actualFee, true);
        }

        emit Buy(tokenAddress, msg.sender, usdcAmount, tokensOut);

        if (referrer != address(0) && referrer != msg.sender) {
            emit Referred(tokenAddress, msg.sender, referrer, usdcAmount);
        }
    }

    /// @dev Pull USDC, mint LT on the net amount, execute the buy, refund the
    ///      pro-rata fee + leftover LT, deliver tokens. Returns `actualFee` in
    ///      USDC awaiting `_accrueFee`; `feeRefund` has already been paid.
    ///      Pro-rating matters when an inline graduation caps the LT consumed:
    ///      the fee scales with the LT actually spent, not the gross USDC in.
    function _executeBuy(
        address tokenAddress,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut, uint256 amountInUsed, uint256 actualFee) {
        address lt = _ltOf(tokenAddress);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        uint256 feeOnGross = (usdcAmount * buyFeeBps) / BPS_DENOM;
        uint256 netUsdc = usdcAmount - feeOnGross;

        usdc.forceApprove(lt, netUsdc);
        uint256 ltMinted = IBounceLeveragedToken(lt).mint(address(this), netUsdc, 0);

        if (bonding.isGraduated(tokenAddress)) {
            tokensOut = _buyOnUniswapV2(tokenAddress, lt, ltMinted);
            amountInUsed = ltMinted;
        } else {
            (tokensOut, amountInUsed) = _buyOnCurve(tokenAddress, lt, ltMinted);
        }

        IERC20(tokenAddress).safeTransfer(msg.sender, tokensOut);

        actualFee = ltMinted == 0 ? 0 : (usdcAmount * buyFeeBps * amountInUsed) / (BPS_DENOM * ltMinted);
        uint256 feeRefund = feeOnGross - actualFee;

        // Refund leftover LT as USDC. Fall back to LT if redeem reverts (e.g.
        // leftover below `MIN_USDC_AMOUNT`).
        uint256 ltLeft = ltMinted - amountInUsed;
        if (ltLeft > 0) {
            try IBounceLeveragedToken(lt).redeem(msg.sender, ltLeft, 0) {}
            catch {
                IERC20(lt).safeTransfer(msg.sender, ltLeft);
                emit LeftoverLTReturned(msg.sender, ltLeft);
            }
        }
        if (feeRefund > 0) {
            usdc.safeTransfer(msg.sender, feeRefund);
        }
    }

    function _ltOf(
        address tokenAddress
    ) internal view returns (address lt) {
        return bonding.ltOf(tokenAddress);
    }

    function _sellInternal(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minUsdcOut
    ) internal returns (uint256 usdcOut) {
        if (tokenAmount == 0) revert InvalidInput();
        if (tokenAddress == address(0)) revert InvalidInput();
        if (bonding.creatorOf(tokenAddress) == address(0)) revert TokenNotTrading();
        if (bonding.isGraduating(tokenAddress)) revert TokenIsGraduating();

        address lt = _ltOf(tokenAddress);

        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), tokenAmount);

        uint256 ltReceived = bonding.isGraduated(tokenAddress)
            ? _sellOnUniswapV2(tokenAddress, lt, tokenAmount)
            : _sellOnCurve(tokenAddress, tokenAmount);

        uint256 grossUsdcEstimate = (ltReceived * IBounceLeveragedToken(lt).exchangeRate()) / 1e18;
        if (grossUsdcEstimate < MIN_USDC_AMOUNT) revert BelowMinAmount();

        // Redeem into this zap (not the user) so we can deduct the fee.
        uint256 grossUsdc = IBounceLeveragedToken(lt).redeem(address(this), ltReceived, 0);

        uint256 fee = (grossUsdc * sellFeeBps) / BPS_DENOM;
        usdcOut = grossUsdc - fee;

        if (usdcOut < minUsdcOut) revert SlippageExceeded();

        usdc.safeTransfer(msg.sender, usdcOut);

        if (fee > 0) {
            _accrueFee(tokenAddress, bonding.creatorOf(tokenAddress), fee, false);
        }

        emit Sell(tokenAddress, msg.sender, tokenAmount, usdcOut);
    }

    // ─── Internal: Fee Accrual ───────────────────────────────────────────

    /// @dev Split into creator / protocol shares, transfer to `FeeVault`, then
    ///      `accrue`. The vault trusts allowlisted depositors to pass truthful
    ///      amounts (cross-checked against its USDC balance).
    function _accrueFee(
        address token,
        address creator,
        uint256 feeAmount,
        bool isBuy
    ) internal {
        uint256 creatorShare = (feeAmount * creatorFeeBps) / BPS_DENOM;
        uint256 protocolShare = feeAmount - creatorShare;
        usdc.safeTransfer(address(feeVault), feeAmount);
        feeVault.accrue(token, creator, creatorShare, protocolShare, isBuy);
    }

    // ─── Internal: Permit ────────────────────────────────────────────────

    /// @dev Catch swallows reverts to defuse permit-front-run DoS: if an
    ///      attacker submits the same sig first the nonce is consumed but the
    ///      allowance is already set, so the follow-on `transferFrom`
    ///      succeeds. A genuinely bad permit is caught downstream by the
    ///      transfer reverting on insufficient allowance — frontends should
    ///      simulate to surface a permit-specific error pre-flight.
    function _tryPermit(
        address token,
        address owner_,
        PermitData calldata p
    ) internal {
        try IERC20Permit(token).permit(owner_, address(this), p.value, p.deadline, p.v, p.r, p.s) {} catch {}
    }

    // ─── Internal: Curve Trades ──────────────────────────────────────────

    function _buyOnCurve(
        address tokenAddress,
        address lt,
        uint256 ltAmount
    ) internal returns (uint256 tokensOut, uint256 amountInUsed) {
        Router curveRouter = bonding.router();
        IERC20(lt).forceApprove(address(curveRouter), ltAmount);
        // Slippage check happens after the refund path in `_buyInternal`.
        // `msg.sender` here is the user-EOA that called `Zap.buy`; passed
        // through as `trader` for the emitted `Trade` event.
        (tokensOut, amountInUsed) = bonding.buy(ltAmount, tokenAddress, 0, msg.sender);
        IERC20(lt).forceApprove(address(curveRouter), 0);
    }

    function _sellOnCurve(
        address tokenAddress,
        uint256 tokenAmount
    ) internal returns (uint256 ltReceived) {
        Router curveRouter = bonding.router();
        IERC20(tokenAddress).forceApprove(address(curveRouter), tokenAmount);
        ltReceived = bonding.sell(tokenAmount, tokenAddress, 0, msg.sender);
    }

    // ─── Internal: V2 Trades ────────────────────────────────────────────

    /// @dev Direct-to-pair swap, bypassing the V2 router. HyperSwap's mainnet
    ///      router has no `swapExactTokensForTokens` (only HYPE-paired
    ///      `swap*Supporting…` variants with a non-standard `referrer`),
    ///      so we go direct to the pair.
    function _swapOnUniswapV2(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        // `graduatedPair` is keyed by the launched token only; check `tokenIn`
        // first (sell direction) then fall back to `tokenOut` (buy direction).
        address pair = bonding.graduatedPair(tokenIn);
        if (pair == address(0)) pair = bonding.graduatedPair(tokenOut);

        (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(pair).getReserves();
        bool inIsToken0 = IUniswapV2Pair(pair).token0() == tokenIn;
        (uint256 reserveIn, uint256 reserveOut) =
            inIsToken0 ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));

        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);

        IERC20(tokenIn).safeTransfer(pair, amountIn);

        (uint256 amount0Out, uint256 amount1Out) = inIsToken0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), new bytes(0));
    }

    function _buyOnUniswapV2(
        address tokenAddress,
        address lt,
        uint256 ltAmount
    ) internal returns (uint256 tokensOut) {
        tokensOut = _swapOnUniswapV2(lt, tokenAddress, ltAmount);
    }

    function _sellOnUniswapV2(
        address tokenAddress,
        address lt,
        uint256 tokenAmount
    ) internal returns (uint256 ltReceived) {
        ltReceived = _swapOnUniswapV2(tokenAddress, lt, tokenAmount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function setBonding(
        address bonding_
    ) external onlyOwner {
        if (bonding_ == address(0)) revert ZeroAddress();
        if (!Bonding(bonding_).isRouter(address(this))) revert BondingNotConfigured();
        bonding = Bonding(bonding_);
        emit BondingUpdated(bonding_);
    }

    function setUniswapV2Router(
        address uniswapV2Router_
    ) external onlyOwner {
        if (uniswapV2Router_ == address(0)) revert ZeroAddress();
        uniswapV2Router = IUniswapV2Router02(uniswapV2Router_);
        emit UniswapV2RouterUpdated(uniswapV2Router_);
    }

    /// @notice Hot-swap the FeeVault. Reverts unless the new vault already
    ///         allowlists this zap as a depositor — otherwise the next
    ///         buy/sell would brick. Owners must `feeVault.addDepositor(zap)`
    ///         on the new vault first.
    function setFeeVault(
        address feeVault_
    ) external onlyOwner {
        if (feeVault_ == address(0)) revert ZeroAddress();
        if (!FeeVault(feeVault_).isDepositor(address(this))) revert VaultNotConfigured();
        feeVault = FeeVault(feeVault_);
        emit FeeVaultUpdated(feeVault_);
    }

    function setFees(
        uint256 buyFeeBps_,
        uint256 sellFeeBps_,
        uint256 creatorFeeBps_
    ) external onlyOwner {
        if (buyFeeBps_ > MAX_FEE_BPS || sellFeeBps_ > MAX_FEE_BPS || creatorFeeBps_ > BPS_DENOM) revert InvalidFee();
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        creatorFeeBps = creatorFeeBps_;
        emit FeesUpdated(buyFeeBps_, sellFeeBps_, creatorFeeBps_);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
