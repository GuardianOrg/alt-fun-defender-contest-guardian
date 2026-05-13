// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IZap, IBondingMinimal} from "./interfaces/IZap.sol";

/// @title BotFeeRouter
/// @notice External-bot fee-skimming router that wraps `Zap`. Pulls user
///         funds, skims `BOT_FEE_BPS` (50 bps = 0.5% flat on USDC notional,
///         both buy and sell), splits the skim 20/80 between an opt-in
///         referrer wallet and an immutable treasury, then forwards the
///         remainder through `Zap.buy` / `Zap.sell`. Bot operator's fee
///         is independent of and additive to Alt Fun's protocol fee.
/// @dev    Immutable by design — no admin key, no upgrade proxy.
///         Parameter changes require a fresh deployment + a new
///         `BOT_FEE_ROUTER_ADDRESS` secret on the bot Worker. This is the
///         explicit guarantee given to traders that the fee can't be turned
///         up post-deploy.
contract BotFeeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOM = 10_000;
    /// @notice Flat bot fee on USDC notional (buy gross + sell gross).
    uint256 public constant BOT_FEE_BPS = 50;
    /// @notice Share of `botFee` routed to the referrer wallet; remainder
    ///         to `treasury`.
    uint256 public constant REFERRER_SHARE_BPS = 2000;

    IZap public immutable zap;
    IERC20 public immutable usdc;
    /// @notice Cold wallet receiving the treasury slice of every trade.
    ///         Baked in at deploy time and never settable — the cold-wallet
    ///         "never signs for payouts" invariant is the reason this
    ///         contract exists.
    address public immutable treasury;

    enum Side {
        Buy,
        Sell
    }

    /// @dev Indexer entity `botRouterTrade` is keyed off this event. Field
    ///      order is part of the wire contract; do not reorder without an
    ///      indexer change.
    event BotRouterTrade(
        address indexed trader,
        address indexed token,
        uint8 side,
        uint256 usdcAmount,
        uint256 tokenAmount,
        uint256 botFee,
        address indexed referrer,
        uint256 referrerCut,
        uint256 treasuryCut
    );

    event ReferralPaid(
        address indexed referrer, address indexed user, uint256 amount, address indexed token, uint8 side
    );

    error ZeroAddress();
    error ZeroAmount();
    error SlippageExceeded();

    constructor(
        IZap zap_,
        IERC20 usdc_,
        address treasury_
    ) {
        if (address(zap_) == address(0) || address(usdc_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        zap = zap_;
        usdc = usdc_;
        treasury = treasury_;
    }

    // ─── Buy ─────────────────────────────────────────────────────────────

    function buyWithBotFee(
        address token,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer
    ) external nonReentrant returns (uint256 tokensOut) {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        return _buy(token, usdcAmount, minTokensOut, referrer);
    }

    function buyWithBotFeePermit(
        address token,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 tokensOut) {
        // Permit allowance against THIS router, then pull. Permit failure
        // (front-run, non-permit token) is fatal here — the bot only takes
        // this branch when permit signing succeeded off-chain.
        IERC20Permit(address(usdc)).permit(msg.sender, address(this), usdcAmount, deadline, v, r, s);
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        return _buy(token, usdcAmount, minTokensOut, referrer);
    }

    function _buy(
        address token,
        uint256 usdcAmount,
        uint256 minTokensOut,
        address referrer
    ) internal returns (uint256 tokensOut) {
        if (usdcAmount == 0) revert ZeroAmount();

        uint256 botFee = (usdcAmount * BOT_FEE_BPS) / BPS_DENOM;
        uint256 net = usdcAmount - botFee;

        (uint256 referrerCut, uint256 treasuryCut) = _splitAndPay(botFee, referrer, msg.sender, token, Side.Buy);

        usdc.forceApprove(address(zap), net);
        // Alt Fun referrer slot is always address(0). This router has its
        // own bot-side referral system (`referrer` arg + `ReferralPaid`
        // event); it does not participate in Alt Fun's wallet-keyed
        // referrer attribution.
        tokensOut = zap.buy(token, net, minTokensOut, address(0));
        IERC20(token).safeTransfer(msg.sender, tokensOut);

        // Sweep user-owed refunds back to the caller. `Zap._executeBuy`'s
        // floor-bump dust-cap branch (a near-graduation buy where the curve
        // can only absorb `MIN_USDC_AMOUNT` worth of LT) refunds the unused
        // USDC + LT chunk to `msg.sender` — which is THIS router. Without
        // this sweep those funds would sit in the router forever. The
        // router never holds USDC / LT between trades by design, so any
        // balance here belongs to the user.
        uint256 usdcDust = usdc.balanceOf(address(this));
        if (usdcDust > 0) {
            usdc.safeTransfer(msg.sender, usdcDust);
        }
        address lt = IBondingMinimal(zap.bonding()).ltOf(token);
        if (lt != address(0)) {
            uint256 ltDust = IERC20(lt).balanceOf(address(this));
            if (ltDust > 0) {
                IERC20(lt).safeTransfer(msg.sender, ltDust);
            }
        }

        emit BotRouterTrade(
            msg.sender, token, uint8(Side.Buy), usdcAmount, tokensOut, botFee, referrer, referrerCut, treasuryCut
        );
    }

    // ─── Sell ────────────────────────────────────────────────────────────

    function sellWithBotFee(
        address token,
        uint256 tokenAmount,
        uint256 minUsdcOut,
        address referrer
    ) external nonReentrant returns (uint256 usdcOut) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        return _sell(token, tokenAmount, minUsdcOut, referrer);
    }

    function sellWithBotFeePermit(
        address token,
        uint256 tokenAmount,
        uint256 minUsdcOut,
        address referrer,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 usdcOut) {
        IERC20Permit(token).permit(msg.sender, address(this), tokenAmount, deadline, v, r, s);
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        return _sell(token, tokenAmount, minUsdcOut, referrer);
    }

    function _sell(
        address token,
        uint256 tokenAmount,
        uint256 minUsdcOut,
        address referrer
    ) internal returns (uint256 usdcOut) {
        if (tokenAmount == 0) revert ZeroAmount();

        IERC20(token).forceApprove(address(zap), tokenAmount);
        // `minUsdcOut` here is the bound on the user's NET receipt, but
        // `Zap.sell` enforces it on the gross USDC it returns to this
        // router. Bump the bound by the bot-fee skim so a tight quote
        // doesn't trip Zap's slippage check on every sell.
        uint256 zapMin = minUsdcOut == 0 ? 0 : (minUsdcOut * BPS_DENOM) / (BPS_DENOM - BOT_FEE_BPS);
        uint256 grossUsdc = zap.sell(token, tokenAmount, zapMin);

        uint256 botFee = (grossUsdc * BOT_FEE_BPS) / BPS_DENOM;
        usdcOut = grossUsdc - botFee;
        // Defence-in-depth — the `zapMin` adjustment above already ensures
        // `usdcOut >= minUsdcOut` for any well-formed `grossUsdc`, but
        // an unexpected gross-side rounding could otherwise leak past the
        // user-visible bound.
        if (usdcOut < minUsdcOut) revert SlippageExceeded();

        (uint256 referrerCut, uint256 treasuryCut) = _splitAndPay(botFee, referrer, msg.sender, token, Side.Sell);

        usdc.safeTransfer(msg.sender, usdcOut);

        emit BotRouterTrade(
            msg.sender, token, uint8(Side.Sell), grossUsdc, tokenAmount, botFee, referrer, referrerCut, treasuryCut
        );
    }

    // ─── Internal: fee split ─────────────────────────────────────────────

    /// @dev Split `botFee` between `referrer` and `treasury` and pay both.
    ///      If the referrer transfer fails (frozen address, contract w/o
    ///      USDC support), the full skim flows to treasury — never block
    ///      the trade on a misconfigured referrer wallet.
    function _splitAndPay(
        uint256 botFee,
        address referrer,
        address user,
        address token,
        Side side
    ) internal returns (uint256 referrerCut, uint256 treasuryCut) {
        if (botFee == 0) {
            return (0, 0);
        }
        if (referrer != address(0)) {
            uint256 candidate = (botFee * REFERRER_SHARE_BPS) / BPS_DENOM;
            if (candidate > 0 && _trySend(referrer, candidate)) {
                referrerCut = candidate;
                emit ReferralPaid(referrer, user, candidate, token, uint8(side));
            }
        }
        treasuryCut = botFee - referrerCut;
        if (treasuryCut > 0) {
            usdc.safeTransfer(treasury, treasuryCut);
        }
    }

    /// @dev Low-level USDC transfer that swallows revert and bool-false
    ///      returns. Used only for the referrer leg of `_splitAndPay`.
    function _trySend(
        address to,
        uint256 amount
    ) internal returns (bool) {
        (bool success, bytes memory data) =
            address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!success) return false;
        if (data.length == 0) return true;
        return abi.decode(data, (bool));
    }
}
