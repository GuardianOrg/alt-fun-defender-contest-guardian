// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Bonding} from "./Bonding.sol";
import {Router} from "./Router.sol";
import {FeeVault} from "./FeeVault.sol";
import {ILeveragedToken} from "./interfaces/ILeveragedToken.sol";
import {IUniswapV2Pair} from "./interfaces/IUniswapV2Pair.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";

/// @title Zap
/// @notice Single entry point for users: pay USDC, receive tokens (and vice versa).
/// @dev Handles USDC -> LT mint -> bonding curve buy (or HyperSwap swap post-graduation).
///      Sell path: token -> curve sell or HyperSwap swap -> LT redeem -> USDC.
///
///      This zap is the fee layer. On every buy and sell, a USDC fee is collected
///      from the user and forwarded to `FeeVault`, which handles creator/protocol
///      accruals and claims. No fees live on `Bonding`, `Router`, or `Factory`.
///
///      EIP-2612 permit variants (`buyWithPermit`, `sellWithPermit`,
///      `createTokenWithPermit`) let a first-time user skip the pre-approve tx:
///      they sign an off-chain permit and the zap applies it before pulling
///      funds. Permits are wrapped in `try/catch` to defuse the standard
///      permit-front-run DoS (if someone else submits the sig first, the nonce
///      is consumed but the allowance is already in place).
contract Zap is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Basis-points denominator. 10_000 = 100%.
    uint256 public constant BPS_DENOM = 10_000;

    /// @dev Hard upper bound on buy/sell fees (2%). Prevents an owner-driven fat-finger.
    uint256 public constant MAX_FEE_BPS = 200;

    Bonding public bonding;
    IERC20 public usdc;
    IUniswapV2Router02 public hyperswapRouter;
    FeeVault public feeVault;

    /// @notice Fee charged on the USDC side of every buy (bps of gross USDC in).
    uint256 public buyFeeBps;
    /// @notice Fee charged on the USDC side of every sell (bps of gross USDC out).
    uint256 public sellFeeBps;
    /// @notice Share of the total fee routed to the creator (bps; remainder goes to protocol).
    uint256 public creatorFeeBps;

    /// @dev Storage gap for future upgrades. Sized so this contract's storage block
    ///      totals 50 slots (7 named + 43 gap). Append new state variables before
    ///      this gap and shrink its length to match.
    uint256[43] private __gap;

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
    event TokenCreated(address indexed token, address indexed creator, address indexed ltAddress);
    event BondingUpdated(address indexed bonding);
    event HyperswapRouterUpdated(address indexed hyperswapRouter);
    event FeeVaultUpdated(address indexed feeVault);
    event FeesUpdated(uint256 buyFeeBps, uint256 sellFeeBps, uint256 creatorFeeBps);

    error InvalidInput();
    error SlippageExceeded();
    error ZeroAddress();
    error InvalidFee();
    error VaultNotConfigured();
    /// @dev Forwarded from `Bonding`: trades are blocked while a token is in
    ///      phase 1 of graduation (awaiting `finalizeGraduation`). Distinct from
    ///      a generic revert so the frontend can show the "Token is graduating"
    ///      overlay rather than a fee/balance error.
    error TokenIsGraduating();
    /// @dev Raised when buy/sell targets an address that was never registered
    ///      as a launched token. Mirrors `Bonding.TokenNotTrading`. Caught
    ///      upfront in `Zap` so unknown tokens revert before any USDC moves —
    ///      otherwise the call would propagate into `_executeBuy`'s USDC
    ///      transfer and LT approve and revert deep in `SafeERC20` with an
    ///      opaque error.
    error TokenNotTrading();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address bonding_,
        address usdc_,
        address hyperswapRouter_,
        address feeVault_,
        uint256 buyFeeBps_,
        uint256 sellFeeBps_,
        uint256 creatorFeeBps_
    ) external initializer {
        if (bonding_ == address(0) || usdc_ == address(0) || hyperswapRouter_ == address(0) || feeVault_ == address(0)) revert ZeroAddress();
        if (buyFeeBps_ > MAX_FEE_BPS || sellFeeBps_ > MAX_FEE_BPS || creatorFeeBps_ > BPS_DENOM) revert InvalidFee();
        __Ownable_init(msg.sender);
        bonding = Bonding(bonding_);
        usdc = IERC20(usdc_);
        hyperswapRouter = IUniswapV2Router02(hyperswapRouter_);
        feeVault = FeeVault(feeVault_);
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        creatorFeeBps = creatorFeeBps_;
    }

    /// @notice Create a new token on the bonding curve
    /// @param params Launch parameters (name, ticker, description, image, urls, ltAddress)
    /// @param seedUsdcAmount USDC amount for seed buy (0 = no seed buy). Routed
    ///                       through the standard buy path so it gets the same
    ///                       pro-rata fee handling, leftover-LT-to-USDC refund,
    ///                       and `Buy` event as a regular post-launch buy.
    function createToken(
        Bonding.LaunchParams calldata params,
        uint256 seedUsdcAmount
    ) external nonReentrant returns (address tokenAddr) {
        return _createTokenInternal(params, seedUsdcAmount);
    }

    /// @notice Create a new token, applying an EIP-2612 permit on USDC first.
    /// @dev Permit is only consumed if a seed buy is requested. For a pure
    ///      create (no seed buy) the zap needs no USDC, so any provided
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
    /// @dev Requires the token to support EIP-2612 (all `Token`s launched by
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
        if (params.ltAddress == address(0)) revert InvalidInput();

        (tokenAddr,) = bonding.launch(params, msg.sender);
        emit TokenCreated(tokenAddr, msg.sender, params.ltAddress);

        // Seed buys reuse the standard buy path so they inherit the same
        // pro-rata fee accrual and leftover-LT-to-USDC refund logic. This
        // matters when the curve graduates inline (USD trigger) and `Bonding`
        // caps the LT actually consumed — the fee is then charged only on the
        // portion of USDC that was really spent. `referrer = address(0)` and
        // `minTokensOut = 0` because seed buys are user-driven from the same
        // tx that launched the token; slippage here is meaningless.
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

    /// @dev Core buy cash-flow: pull USDC, mint LT on the net portion, execute
    ///      the curve/HyperSwap buy, refund any leftover (LT and pro-rata fee),
    ///      and deliver tokens. Returned `actualFee` is USDC sitting in the
    ///      zap awaiting `_accrueFee`; `feeRefund` has already been paid out.
    function _executeBuy(
        address tokenAddress,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut, uint256 amountInUsed, uint256 actualFee) {
        address lt = _ltOf(tokenAddress);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        uint256 feeOnGross = (usdcAmount * buyFeeBps) / BPS_DENOM;
        uint256 netUsdc = usdcAmount - feeOnGross;

        // USDC -> LT on the net amount (fee stays in the zap as USDC).
        usdc.forceApprove(lt, netUsdc);
        uint256 ltMinted = ILeveragedToken(lt).mint(address(this), netUsdc, 0);

        if (bonding.isGraduated(tokenAddress)) {
            // HyperSwap consumes the full LT amount (no supply cap).
            tokensOut = _buyOnHyperswap(tokenAddress, lt, ltMinted);
            amountInUsed = ltMinted;
        } else {
            (tokensOut, amountInUsed) = _buyOnCurve(tokenAddress, lt, ltMinted);
        }

        IERC20(tokenAddress).safeTransfer(msg.sender, tokensOut);

        // Pro-rate the fee by the fraction of LT actually consumed. The remainder
        // (leftover LT + unused fee in USDC) is refunded to the user as USDC.
        actualFee = ltMinted == 0 ? 0 : (usdcAmount * buyFeeBps * amountInUsed) / (BPS_DENOM * ltMinted);
        uint256 feeRefund = feeOnGross - actualFee;

        // Refund leftover LT -> USDC to the user. Fall back to LT if redeem reverts.
        uint256 ltLeft = ltMinted - amountInUsed;
        if (ltLeft > 0) {
            IERC20(lt).forceApprove(lt, ltLeft);
            try ILeveragedToken(lt).redeem(msg.sender, ltLeft, 0) {
            // delivered as USDC
            }
            catch {
                IERC20(lt).safeTransfer(msg.sender, ltLeft);
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
            ? _sellOnHyperswap(tokenAddress, lt, tokenAmount)
            : _sellOnCurve(tokenAddress, tokenAmount);

        // LT -> USDC into this zap (not the user) so we can deduct the fee.
        IERC20(lt).forceApprove(lt, ltReceived);
        uint256 grossUsdc = ILeveragedToken(lt).redeem(address(this), ltReceived, 0);

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

    /// @dev Split `feeAmount` USDC into creator / protocol shares, forward to
    ///      `FeeVault` via a `transfer` + `accrue` call. The vault trusts
    ///      allowlisted depositors to pass truthful amounts.
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

    /// @dev Apply an EIP-2612 permit from `owner_` to this zap. Swallows
    ///      reverts to defuse the standard permit-front-run DoS: if an
    ///      attacker observes the mempool and submits the same sig first,
    ///      the nonce is consumed but the allowance is already set, so the
    ///      follow-on `transferFrom` still succeeds. If the permit was never
    ///      applied (e.g. bad sig), the subsequent transfer will revert,
    ///      which is the correct behaviour.
    ///
    ///      Failure modes worth knowing:
    ///       - Bad permit (wrong sig, expired deadline, wrong owner): the
    ///         catch swallows the revert, no allowance is set, and the
    ///         subsequent `safeTransferFrom` reverts with
    ///         `ERC20InsufficientAllowance` (or the legacy "transfer amount
    ///         exceeds allowance" string). The user pays gas for the failed
    ///         permit + the failed prefix of the buy/sell flow. Frontends
    ///         SHOULD simulate the permit (e.g. via `eth_call` or a wallet
    ///         simulation) before submitting so users see a permit-specific
    ///         error rather than the misleading allowance one.
    ///       - Out-of-gas inside `permit`: Solidity `try/catch` does NOT
    ///         catch OOG — the entire tx reverts. Not a vulnerability, just a
    ///         quirk of the EVM `try/catch` semantics.
    function _tryPermit(
        address token,
        address owner_,
        PermitData calldata p
    ) internal {
        try IERC20Permit(token).permit(owner_, address(this), p.value, p.deadline, p.v, p.r, p.s) {}
            catch {
            // intentional: see natspec
        }
    }

    // ─── Internal: Curve Trades ──────────────────────────────────────────

    function _buyOnCurve(
        address tokenAddress,
        address lt,
        uint256 ltAmount
    ) internal returns (uint256 tokensOut, uint256 amountInUsed) {
        Router curveRouter = bonding.router();
        IERC20(lt).forceApprove(address(curveRouter), ltAmount);
        // Slippage is checked in Zap.buy after the refund path, so pass 0 here.
        // `msg.sender` is preserved across the internal call, so it's the user
        // who invoked `Zap.buy` — passed through to Bonding as the
        // `trader` for the emitted `Trade` event. Zap is trusted by Bonding
        // (it's on the `isRouter` allowlist), so this attribution is not
        // spoofable by any other caller.
        (tokensOut, amountInUsed) = bonding.buy(ltAmount, tokenAddress, 0, msg.sender);
    }

    function _sellOnCurve(
        address tokenAddress,
        uint256 tokenAmount
    ) internal returns (uint256 ltReceived) {
        Router curveRouter = bonding.router();
        IERC20(tokenAddress).forceApprove(address(curveRouter), tokenAmount);
        ltReceived = bonding.sell(tokenAmount, tokenAddress, 0, msg.sender);
    }

    // ─── Internal: HyperSwap Trades ─────────────────────────────────────

    /// @dev Direct-to-pair swap, bypassing the HyperSwap V2 router. The
    ///      deployed mainnet router (`0xb4a9C4e6…`) only exposes
    ///      `addLiquidity*` plus the HYPE-paired `swap*Supporting…` variants
    ///      with a non-standard `referrer` parameter — it has no
    ///      `swapExactTokensForTokens`. Calling the pair directly is the
    ///      canonical UniswapV2 pattern (`transfer → pair.swap`) and works
    ///      against any V2-compatible pair, so we don't depend on the router
    ///      having a particular ABI.
    function _swapOnHyperswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        // `Bonding._graduate` stores `graduatedPair` only under the launched token
        // address (not the LT). Check `tokenIn` first for the sell direction
        // (launched token -> LT), then fall back to `tokenOut` for the buy
        // direction (LT -> launched token).
        address pair = bonding.graduatedPair(tokenIn);
        if (pair == address(0)) pair = bonding.graduatedPair(tokenOut);

        (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(pair).getReserves();
        bool inIsToken0 = IUniswapV2Pair(pair).token0() == tokenIn;
        (uint256 reserveIn, uint256 reserveOut) =
            inIsToken0 ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));

        // Standard UniswapV2 constant-product formula with 0.3% fee.
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);

        IERC20(tokenIn).safeTransfer(pair, amountIn);

        (uint256 amount0Out, uint256 amount1Out) = inIsToken0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), new bytes(0));
    }

    function _buyOnHyperswap(
        address tokenAddress,
        address lt,
        uint256 ltAmount
    ) internal returns (uint256 tokensOut) {
        // Slippage is enforced by the caller (`_buyInternal` checks
        // `tokensOut < minTokensOut`), so no per-hop minOut needed here.
        tokensOut = _swapOnHyperswap(lt, tokenAddress, ltAmount);
    }

    function _sellOnHyperswap(
        address tokenAddress,
        address lt,
        uint256 tokenAmount
    ) internal returns (uint256 ltReceived) {
        ltReceived = _swapOnHyperswap(tokenAddress, lt, tokenAmount);
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

    /// @notice Hot-swap the FeeVault. Reverts if the new vault hasn't already
    ///         allowlisted this zap as a depositor — without that, the very
    ///         next buy/sell would revert in `FeeVault.accrue` and brick
    ///         trading. Owners must `feeVault.addDepositor(zap)` on the new
    ///         vault first, then call this.
    function setFeeVault(
        address feeVault_
    ) external onlyOwner {
        if (feeVault_ == address(0)) revert ZeroAddress();
        if (!FeeVault(feeVault_).isDepositor(address(this))) revert VaultNotConfigured();
        feeVault = FeeVault(feeVault_);
        emit FeeVaultUpdated(feeVault_);
    }

    /// @notice Update fee parameters. Bounded by `MAX_FEE_BPS` on each side and
    ///         `BPS_DENOM` on the creator split.
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
