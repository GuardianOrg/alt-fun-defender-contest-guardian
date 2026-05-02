// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {DeployHelper} from "./DeployHelper.sol";
import {MockHyperswapPair, MockHyperswapFactory} from "./mocks/MockHyperswapRouter.sol";

/// @notice Regression suite for issue #308 — hostile HyperSwap pair pre-seed.
/// @dev Two attack shapes are covered:
///        1. **Pure-donation pre-seed.** Attacker calls
///           `IERC20(token).transfer(pair, X)` without ever calling
///           `pair.mint`. Reserves stay at zero; balance > 0. The
///           protocol's `pair.skim(lpLock)` call sweeps the donation
///           BACK to LPLock and the rebalance branch is never entered.
///        2. **Mint pre-seed (the issue).** Attacker calls `pair.mint`
///           against a self-funded dust seed. Reserves are non-zero at
///           a hostile ratio; without the rebalance branch, our
///           subsequent `pair.mint(lpLock)` would (a) open the LP
///           off-curve-close-price and (b) donate the larger arm of
///           `min(amount0·S/r0, amount1·S/r1)` to the attacker's LP.
///
///      The end-to-end properties asserted across both shapes:
///        • finalize NEVER reverts (brick resistance preserved)
///        • post-mint pool ratio matches curve close within tolerance
///        • our LP reaches LPLock; attacker LP value bounded by their
///          pre-seed cost (no extraction from our deposit)
///        • TOKEN-side leftover is burned; LT-side leftover is held
///          in `Bonding` and recoverable via `rescueLT`
///
///      Where these tests overlap with `TwoPhaseGraduation.t.sol`'s
///      original brick-resistance coverage, the assertions here are
///      strictly stronger: that suite asserted "finalize succeeds and
///      LP is locked", we additionally assert "AND opens at the right
///      price AND attacker can't extract value".
contract HostilePreSeedTest is DeployHelper {
    address public attacker = makeAddr("attacker");
    address public stranger = makeAddr("stranger");

    /// @dev Tolerance for the "post-mint pool price ≈ curve close" check.
    ///      The rebalance uses a no-fee `sqrt` approximation against a
    ///      fee-charging V2 swap, leaving a residual ~30 bps drift at the
    ///      worst-case pre-seed shapes; the subsequent `quote()`-based
    ///      `addLiquidity` adds another ~10 bps of integer-rounding
    ///      headroom. 50 bps is the structural ceiling — anything beyond
    ///      that signals an actual exploit, since the security property
    ///      we care about ("attacker cannot extract value from our
    ///      deposit") is independent of the residual price gap and is
    ///      asserted directly via `_assertAttackerNoProfit` /
    ///      attacker-LP-share bounds in the per-shape tests below.
    uint256 internal constant PRICE_MATCH_EPS_BPS = 50;

    /// @dev Snapshot of the curve-close ratio captured BEFORE
    ///      `finalizeGraduation` runs (which `delete`s `pendingGraduation`).
    ///      Compared against the post-mint pool reserves to assert the
    ///      zero-gap property survived the rebalance.
    struct CurveClose {
        uint256 tokensForLP;
        uint256 ltFromPair;
    }

    function setUp() public {
        _deployCore();
        bonding.addRouter(creator);
        bonding.addRouter(trader);
        bonding.addRouter(trader2);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchToken() internal returns (address tokenAddr, address pairAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "PreSeed",
            ticker: "PS",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "PreSeed", "PS")
        });
        vm.prank(creator);
        (tokenAddr, pairAddr) = bonding.launch(params, creator);
        vm.roll(block.number + bonding.LAUNCH_TRADING_DELAY_BLOCKS() + 1);
    }

    /// @dev Drive the curve into `Graduating` without finalizing. Mirrors
    ///      `TwoPhaseGraduationTest._enterGraduating` but consolidated here
    ///      so this suite stands alone.
    function _enterGraduating(
        address tokenAddr
    ) internal {
        _bondingBuy(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _bondingBuy(tokenAddr, trader2, _ltGraduationTrigger());
        require(bonding.isGraduating(tokenAddr), "test setup: phase 1 did not fire");
    }

    function _bondingBuy(
        address tokenAddr,
        address buyer,
        uint256 ltAmount
    ) internal {
        lt.mintDirect(buyer, ltAmount);
        if (!bonding.isRouter(buyer)) bonding.addRouter(buyer);
        vm.startPrank(buyer);
        lt.approve(address(curveRouter), ltAmount);
        bonding.buy(ltAmount, tokenAddr, 0, buyer);
        vm.stopPrank();
    }

    /// @dev Pre-create the HyperSwap pair so the attacker can mint into it.
    function _createHyperswapPair(
        address tokenAddr
    ) internal returns (MockHyperswapPair pair) {
        MockHyperswapFactory hsFactory = MockHyperswapFactory(hyperswapRouter.factory());
        pair = MockHyperswapPair(hsFactory.createPair(tokenAddr, address(lt)));
    }

    /// @dev Snapshot the curve-close ratio while it's still readable (i.e.
    ///      between phase-1 (`Graduating` set) and phase-2 (`finalizeGraduation`
    ///      `delete`s `pendingGraduation`)). MUST be called between
    ///      `_enterGraduating` and `bonding.finalizeGraduation`.
    function _snapshotCurveClose(
        address tokenAddr
    ) internal view returns (CurveClose memory snap) {
        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);
        snap = CurveClose({tokensForLP: tokensForLP, ltFromPair: ltFromPair});
    }

    /// @dev Read the HyperSwap pair's stored reserves in (TOKEN, LT) order.
    function _readReservesByToken(
        address pair,
        address tokenAddr
    ) internal view returns (uint256 reserveToken, uint256 reserveLT) {
        (uint112 r0, uint112 r1,) = MockHyperswapPair(pair).getReserves();
        bool tokenIs0 = MockHyperswapPair(pair).token0() == tokenAddr;
        return tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    /// @dev Assert the post-mint pool ratio matches the pre-finalize curve-
    ///      close ratio within `PRICE_MATCH_EPS_BPS`.
    function _assertZeroPriceGap(
        address pair,
        address tokenAddr,
        CurveClose memory snap
    ) internal view {
        if (snap.tokensForLP == 0) return; // happy-path / no-op cases
        (uint256 reserveToken, uint256 reserveLT) = _readReservesByToken(pair, tokenAddr);
        if (reserveToken == 0) return;

        // ratio match: reserveLT / reserveToken vs snap.ltFromPair / snap.tokensForLP
        // cross-multiply: reserveLT * snap.tokensForLP vs reserveToken * snap.ltFromPair
        uint256 lhs = reserveLT * snap.tokensForLP;
        uint256 rhs = reserveToken * snap.ltFromPair;
        uint256 diff = lhs > rhs ? lhs - rhs : rhs - lhs;
        uint256 denom = lhs > rhs ? lhs : rhs;
        if (denom == 0) return;
        require(diff * 10_000 <= PRICE_MATCH_EPS_BPS * denom, "LP open price diverges from curve close");
    }

    /// @dev Common setup pattern: launch + create HyperSwap pair + give the
    ///      attacker some curve TOKEN to use for pre-seeding. We do the
    ///      attacker's small curve buy BEFORE staging so it doesn't
    ///      accidentally push the curve over the test threshold.
    ///      `attackerSpendLt` is sized to leave room for the staged buy in
    ///      `_enterGraduating`.
    function _setupWithAttackerTokens(
        uint256 attackerSpendLt
    ) internal returns (address tokenAddr, MockHyperswapPair pair) {
        (tokenAddr,) = _launchToken();
        pair = _createHyperswapPair(tokenAddr);
        if (attackerSpendLt > 0) _bondingBuy(tokenAddr, attacker, attackerSpendLt);
    }

    /// @dev Attacker pre-seeds the HyperSwap pair via mint. Asserts the
    ///      pre-seed produced LP for the attacker (test sanity).
    function _attackerMintPreSeed(
        MockHyperswapPair pair,
        address tokenAddr,
        uint256 tokenAmt,
        uint256 ltAmt
    ) internal returns (uint256 attackerLP) {
        require(IERC20(tokenAddr).balanceOf(attacker) >= tokenAmt, "test setup: attacker short on TOKEN");
        lt.mintDirect(attacker, ltAmt);
        vm.startPrank(attacker);
        IERC20(tokenAddr).transfer(address(pair), tokenAmt);
        lt.transfer(address(pair), ltAmt);
        attackerLP = pair.mint(attacker);
        vm.stopPrank();
        require(attackerLP > 0, "test setup: pre-seed must mint LP");
    }

    // ─── Sanity: empty-pair (happy path) preserved ───────────────────────

    /// @dev With no pre-seed at all, finalize must still produce zero gap.
    ///      This is the regression check that the "rebalance branch hides
    ///      a regression in the empty-pair branch" — it doesn't, the
    ///      empty-pair fast path is taken and matches the original code.
    function test_happyPath_noPreSeed_zeroGap() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);

        bonding.finalizeGraduation(tokenAddr);
        address hyperPair = bonding.graduatedPair(tokenAddr);
        assertTrue(hyperPair != address(0));

        _assertZeroPriceGap(hyperPair, tokenAddr, snap);

        // No leftover anywhere: LP locked, no LT in Bonding.
        assertEq(lt.balanceOf(address(bonding)), 0, "no LT leftover on happy path");
        assertEq(IERC20(tokenAddr).balanceOf(address(bonding)), 0, "no TOKEN leftover on happy path");
    }

    // ─── Pure-donation pre-seed (skim handles it) ────────────────────────

    /// @dev Donation-only pre-seed: attacker transfers tokens to the pair
    ///      WITHOUT calling `pair.mint`. Reserves stay at zero. Our skim
    ///      sweeps the donation back to LPLock; the empty-pair fast path
    ///      then runs unchanged.
    function test_donationPreSeed_skimsBackToLPLock() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(0);

        // Attacker donates 30 LT to the pair. Reserves stay zero.
        uint256 donation = 30 ether;
        lt.mintDirect(attacker, donation);
        vm.prank(attacker);
        lt.transfer(address(pair), donation);

        (uint112 r0Pre, uint112 r1Pre,) = pair.getReserves();
        assertEq(r0Pre, 0, "donation must not move stored reserves");
        assertEq(r1Pre, 0);
        assertEq(lt.balanceOf(address(pair)), donation, "donation in pair balance");

        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        // The donation went to lpLock (the skim recipient).
        assertEq(lt.balanceOf(address(lpLockContract)), donation, "donation must land on LPLock");

        // Pool opens at curve-close price (skim → empty-pair fast path).
        _assertZeroPriceGap(address(pair), tokenAddr, snap);
    }

    // ─── Mint pre-seed (the actual issue #308 exploit) ───────────────────

    /// @dev Smallest hostile mint pre-seed from the pentest report:
    ///      "1 wei + 1 LT". With the OLD direct-mint code, this captured
    ///      34 bps of LP and stranded 622k tokens. With the new code,
    ///      the rebalance defuses both.
    function test_mintPreSeed_dustSize_zeroGap_attackerNoCapture() public {
        // Attacker spends 1 LT to acquire ~1 wei of TOKEN before staging.
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(1 ether);

        // Pre-seed: 1 wei + 1 LT (per the pentest example).
        uint256 attackerLPPre = _attackerMintPreSeed(pair, tokenAddr, 1, 1 ether);

        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        // The pool opens at curve-close price.
        _assertZeroPriceGap(address(pair), tokenAddr, snap);

        // LPLock holds substantial LP — we successfully locked the mint.
        uint256 lpLockBalance = pair.balanceOf(address(lpLockContract));
        assertGt(lpLockBalance, 0, "LPLock must hold protocol LP");
        // Attacker holds at most their pre-seed LP (no capture from our deposit).
        // With dust pre-seed, attacker LP share is < 1% of total.
        uint256 totalLP = pair.totalSupply();
        assertLt(attackerLPPre * 10_000 / totalLP, 100, "attacker LP share <1% on dust pre-seed");
    }

    /// @dev Medium-sized hostile mint pre-seed: 100k tokens + 1 LT
    ///      (pentest "hostile-skew" case → originally a 27 bps gap).
    function test_mintPreSeed_hostileSkew_zeroGap() public {
        // Spend 5 LT for ~47M TOKEN at curve start — plenty for a 100k seed.
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(5 ether);
        _attackerMintPreSeed(pair, tokenAddr, 100_000 ether, 1 ether);

        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        _assertZeroPriceGap(address(pair), tokenAddr, snap);
        assertGt(pair.balanceOf(address(lpLockContract)), 0, "LPLock must hold protocol LP after rebalance");
    }

    /// @dev Pentest "scaled" case: 18.75M tokens + 15 LT pre-seed (originally
    ///      a 454 bps opening gap). Verifies the rebalance handles the
    ///      "50% of curve close" scenario from `IN-02`.
    function test_mintPreSeed_pentestScaledCase_zeroGap() public {
        // Derive the minimum LT to acquire 18.75M TOKEN from a fresh constant-
        // product curve: ltIn = virtualLt × tokensOut / (totalSupply − tokensOut).
        // +10% margin absorbs integer-rounding so this stays green across
        // future VIRTUAL_LIQUIDITY_USD retunes without manual bumping.
        uint256 targetTokens = 18_750_000 ether;
        uint256 minLt = (_initialVirtualLt() * targetTokens) / (Token.TOTAL_SUPPLY - targetTokens);
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens((minLt * 110) / 100);
        _attackerMintPreSeed(pair, tokenAddr, targetTokens, 15 ether);

        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        _assertZeroPriceGap(address(pair), tokenAddr, snap);
    }

    // ─── Mirror image: pre-seed makes pool LT-rich (other swap direction) ─

    /// @dev Most pentest cases pre-seed TOKEN-rich. This case pre-seeds
    ///      LT-rich, exercising the OPPOSITE swap direction in the
    ///      rebalance branch (swap TOKEN in, get LT out).
    function test_mintPreSeed_LTRich_zeroGap() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(1 ether);
        // Pool starts ultra-LT-rich (pre-seed at $30 LT for 1 TOKEN).
        _attackerMintPreSeed(pair, tokenAddr, 1 ether, 30 ether);

        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        _assertZeroPriceGap(address(pair), tokenAddr, snap);
        assertGt(pair.balanceOf(address(lpLockContract)), 0, "LPLock must hold protocol LP");
    }

    // ─── Pre-seed at exactly curve-close ratio (no swap should fire) ─────

    /// @dev If the attacker happens to pre-seed near the curve-close
    ///      ratio, the swap is tiny or zero. Validate we still produce
    ///      a clean opening price.
    function test_mintPreSeed_atTargetRatio_noSwap() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(1 ether);
        // 1 TOKEN + 1 LT = 1:1 — close to many feasible curve-close ratios.
        _attackerMintPreSeed(pair, tokenAddr, 1 ether, 1 ether);

        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        _assertZeroPriceGap(address(pair), tokenAddr, snap);
    }

    // ─── Combined attack: mint pre-seed + donation on top ────────────────

    /// @dev Worst-case attacker: mints pre-seed AND adds extra donation.
    ///      Both the skim AND rebalance branches fire.
    function test_combinedAttack_skimAndRebalance_zeroGap() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(5 ether);
        _attackerMintPreSeed(pair, tokenAddr, 50_000 ether, 5 ether);

        // Then donate even more on top (no mint).
        uint256 donation = 20 ether;
        lt.mintDirect(attacker, donation);
        vm.prank(attacker);
        lt.transfer(address(pair), donation);

        _enterGraduating(tokenAddr);
        CurveClose memory snap = _snapshotCurveClose(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        _assertZeroPriceGap(address(pair), tokenAddr, snap);

        // Donation portion (20 ether) should have ended up on LPLock via skim.
        // Lower bound: at least the donation amount routed to LPLock.
        assertGe(lt.balanceOf(address(lpLockContract)), donation, "skim must have transferred donation to LPLock");
    }

    // ─── Brick resistance is preserved ───────────────────────────────────

    /// @dev Same as `TwoPhaseGraduationTest.test_brick_resistance_frontRun_dust_seed`
    ///      but reasserted here so this suite is self-contained: even with the
    ///      new rebalance branch, finalize NEVER reverts on a hostile pre-seed.
    function test_brickResistance_arbitraryPreSeed_finalizeAlwaysSucceeds() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(1 ether);
        _attackerMintPreSeed(pair, tokenAddr, 7777, 12_345);

        _enterGraduating(tokenAddr);
        bonding.finalizeGraduation(tokenAddr); // must not revert

        assertTrue(bonding.isGraduated(tokenAddr));
    }

    /// @notice Catastrophic-pre-seed regression: an attacker with overwhelming
    ///         capital pre-seeds the pool such that the no-fee swap input
    ///         to drive the ratio back to curve-close exceeds our per-side
    ///         budget. Without the 99% `_swapBudget` cap, `_pairRebalance`
    ///         would clamp the swap at the full budget, consume 100% of one
    ///         side of our inventory, and leave `_routerDepositAndDispose`
    ///         with `remToken == 0` (or `remLT == 0`); `addLiquidity` would
    ///         skip, `liquidity` would return 0, and `LPLock.recordLock`
    ///         would record a zero-sized lock — the attacker's pre-existing
    ///         LP would become 100% of the pool's LP supply.
    /// @dev    Pre-seed `(1000 ether TOKEN, 1e9 ether LT)` is sized to
    ///         deterministically trigger the `_swapBudget` cap on a
    ///         standard test graduation. The attacker has poured ~$1B of
    ///         LT into the pre-seed (way beyond any realistic attack
    ///         budget) — at this scale the rebalance can't fully reach
    ///         the curve-close ratio with our per-side budget. The cap
    ///         leaves 1% of the swap-side budget for the deposit, so
    ///         `addLiquidity` always lands and LPLock holds a non-zero
    ///         (if proportionally small) LP claim. Brick-resistance
    ///         preserved; attacker doesn't get 100% of the pool.
    function test_catastrophicPreSeed_capPreservesNonZeroLpLock() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(1 ether);
        // Mint enough TOKEN to the attacker to seed the catastrophic shape
        // (test fixture only gives ~9.9M ether from a 1-ether LT spend at
        // curve start, but we need 1000 ether — well within that envelope).
        _attackerMintPreSeed(pair, tokenAddr, 1000 ether, 1_000_000_000 ether);

        _enterGraduating(tokenAddr);
        bonding.finalizeGraduation(tokenAddr); // must not revert despite cap firing

        assertTrue(bonding.isGraduated(tokenAddr));
        assertGt(
            pair.balanceOf(address(lpLockContract)),
            0,
            "LPLock must hold some LP -- without the swap-budget cap this would be 0"
        );
    }

    // ─── Leftover recovery (rescueLT admin sweep) ────────────────────────

    /// @dev After a rebalance, LT leftover sits in `Bonding`'s balance.
    ///      Owner can sweep it via `rescueLT(lt, to, amount)`. TOKEN
    ///      leftover is burned during finalize, so it never accumulates.
    ///      Asserts the on-chain `LTRescued` event so the destination of
    ///      every sweep is observable in indexer / monitoring.
    /// @dev    Pre-seed shape `(1 ether TOKEN, 30 ether LT)` is chosen
    ///         deterministically so the swap rebalances the pool fully to
    ///         the curve-close ratio with budget to spare; the deposit
    ///         then matches against the pool ratio, fully consuming our
    ///         TOKEN side and leaving an LT remainder. The earlier
    ///         `(1 wei, 30 ether)` shape was so extremely LT-rich that
    ///         the rebalance swap was tiny and the deposit ended up
    ///         consuming all our LT instead — leftover was 0 and the
    ///         test silently no-op'd. With `(1 ether, 30 ether)` the
    ///         leftover is reliably > 0 (~30 ether of LT — close to the
    ///         attacker's pre-seed amount).
    function test_leftoverRecovery_rescueLT_movesLeftoverToReceiverAndEmits() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(1 ether);
        _attackerMintPreSeed(pair, tokenAddr, 1 ether, 30 ether);

        _enterGraduating(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        uint256 leftover = lt.balanceOf(address(bonding));
        assertGt(leftover, 0, "test setup: pre-seed shape must deterministically produce LT leftover");

        address receiver = makeAddr("treasury");
        vm.expectEmit(true, true, false, true, address(bonding));
        emit Bonding.LTRescued(address(lt), receiver, leftover);
        bonding.rescueLT(address(lt), receiver, leftover);

        assertEq(lt.balanceOf(receiver), leftover, "rescueLT must transfer to receiver");
        assertEq(lt.balanceOf(address(bonding)), 0, "Bonding LT balance cleared");
    }

    function test_rescueLT_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        bonding.rescueLT(address(lt), stranger, 1);
    }

    function test_rescueLT_revertsOnZeroAddress() public {
        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.rescueLT(address(0), address(this), 1);

        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.rescueLT(address(lt), address(0), 1);
    }

    // ─── Token leftover is burned (supply conservation) ──────────────────

    /// @dev TOKEN leftover from the off-ratio remainder of our deposit
    ///      should be burned by `_mintBalancedAndBurn`, reducing the
    ///      circulating supply by the donated-side amount. This is the
    ///      "no TOKEN dust accumulates in Bonding across many graduations"
    ///      property.
    function test_leftoverRecovery_tokenLeftoverBurned() public {
        (address tokenAddr, MockHyperswapPair pair) = _setupWithAttackerTokens(5 ether);
        // Pool TOKEN-rich pre-seed → swap LT in → TOKEN-side has leftover
        // that needs burning.
        _attackerMintPreSeed(pair, tokenAddr, 100_000 ether, 1 ether);

        _enterGraduating(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        // Bonding's TOKEN balance should be zero (all burned or sent to pair).
        assertEq(IERC20(tokenAddr).balanceOf(address(bonding)), 0, "no TOKEN leftover in Bonding after burn");
    }

    // ─── Phase-1 invariants are not affected by phase-2 changes ──────────

    /// @dev `_seedRebalancing` only runs in phase 2. Phase 1 (the inline
    ///      threshold-crossing buy) must stay below HyperEVM's small-block
    ///      gas ceiling exactly as before. Re-asserts the same property
    ///      `TwoPhaseGraduationTest.test_phase1_fits_in_small_block`
    ///      checks, so a regression in phase-1 gas (caused by accidentally
    ///      moving phase-2 code into phase 1) trips here too.
    function test_phase1_gasUnchangedByRebalanceCode() public {
        (address tokenAddr,) = _launchToken();
        _bondingBuy(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        uint256 trigger = _ltGraduationTrigger();
        lt.mintDirect(trader2, trigger);
        vm.startPrank(trader2);
        lt.approve(address(curveRouter), trigger);
        uint256 gasBefore = gasleft();
        bonding.buy(trigger, tokenAddr, 0, trader2);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        assertTrue(bonding.isGraduating(tokenAddr));
        assertLt(gasUsed, 1_800_000, "phase 1 must still fit small block - rebalance is phase-2-only");
    }

    // ─── Fuzz: zero gap across arbitrary pre-seeds ───────────────────────

    /// @notice For ANY pre-seed inside a realistic attacker-capital range,
    ///         post-mint LP price matches curve close within tolerance,
    ///         AND finalize never reverts, AND LPLock receives LP.
    /// @dev    The fuzz domain caps both pre-seed sides well inside what
    ///         the attacker can fund inside the test threshold. Extreme
    ///         out-of-band pre-seeds push the rebalance into the
    ///         "cap at budget" regime — that's correct (the cap reduces
    ///         but doesn't eliminate the gap) but trips the strict
    ///         zero-gap assert. We exercise the cap regime separately
    ///         via the deterministic worst-case tests above.
    ///
    ///         The lower bounds on `preseedTokenIn` / `preseedLT` are
    ///         calibrated so `sqrt(preseedToken * preseedLT) > MINIMUM_LIQUIDITY (1000)`
    ///         on the canonical V2 first-mint check — pre-seeds below that
    ///         can't actually exist on-chain (the attacker's `pair.mint`
    ///         would revert), so excluding them isn't a coverage gap.
    function testFuzz_arbitraryPreSeed_zeroGap(
        uint256 preseedTokenRaw,
        uint256 preseedLTRaw
    ) public {
        // Bounds satisfy MINIMUM_LIQUIDITY (sqrt > 1000): both ≥ 1 ether
        // means product ≥ 1e36, sqrt ≥ 1e18 ≫ 1000.
        uint256 preseedTokenIn = bound(preseedTokenRaw, 1 ether, 1_000_000 ether);
        // Cap below test-suite threshold to avoid pre-graduating the curve
        // before staging.
        uint256 preseedLT = bound(preseedLTRaw, 1 ether, 30 ether);

        (address tokenAddr, address pair, CurveClose memory snap, uint256 actualPreseedToken,) =
            _setupAttackerPreSeed(preseedTokenIn, preseedLT);
        if (pair == address(0) || actualPreseedToken == 0) return;

        bonding.finalizeGraduation(tokenAddr); // must not revert

        _assertZeroPriceGap(pair, tokenAddr, snap);
        assertGt(MockHyperswapPair(pair).balanceOf(address(lpLockContract)), 0, "LPLock got LP");
    }

    /// @notice Attacker LP value at curve-close prices is bounded by
    ///         their pre-seed cost, regardless of pre-seed shape.
    ///         I.e., the attack has a non-positive expected value (modulo
    ///         the swap fee they pay back to themselves as ~0% LP).
    function testFuzz_attacker_cannotProfit(
        uint256 preseedTokenRaw,
        uint256 preseedLTRaw
    ) public {
        uint256 preseedTokenIn = bound(preseedTokenRaw, 1 ether, 1_000_000 ether);
        uint256 preseedLT = bound(preseedLTRaw, 1 ether, 30 ether);

        (address tokenAddr, address pair, CurveClose memory snap, uint256 actualPreseedToken, uint256 actualPreseedLT) =
            _setupAttackerPreSeed(preseedTokenIn, preseedLT);
        if (pair == address(0) || actualPreseedToken == 0) return;

        bonding.finalizeGraduation(tokenAddr);

        _assertAttackerNoProfit(tokenAddr, pair, actualPreseedToken, actualPreseedLT, snap);
    }

    /// @dev Setup-and-pre-seed step common to several no-profit fuzz cases.
    ///      Returns (token, pair, snapshot of curve close before finalize, the
    ///      ACTUAL pre-seed amounts used after capping by attacker's TOKEN budget).
    function _setupAttackerPreSeed(
        uint256 preseedToken,
        uint256 preseedLT
    )
        internal
        returns (
            address tokenAddr,
            address pairAddr,
            CurveClose memory snap,
            uint256 actualPreseedToken,
            uint256 actualPreseedLT
        )
    {
        // Spend 5 LT up-front to fund the attacker with curve TOKEN — much
        // more than enough for any pre-seed in the fuzz domain.
        MockHyperswapPair pair;
        (tokenAddr, pair) = _setupWithAttackerTokens(5 ether);
        pairAddr = address(pair);

        uint256 atkBal = IERC20(tokenAddr).balanceOf(attacker);
        actualPreseedToken = atkBal < preseedToken ? atkBal : preseedToken;
        actualPreseedLT = preseedLT;
        if (actualPreseedToken == 0) return (tokenAddr, address(0), snap, 0, 0);

        _attackerMintPreSeed(pair, tokenAddr, actualPreseedToken, actualPreseedLT);

        _enterGraduating(tokenAddr);
        snap = _snapshotCurveClose(tokenAddr);
    }

    /// @dev Attacker LP value at curve-close prices must not exceed their
    ///      pre-seed cost (within a 1% slack for `min()` and fee rounding).
    function _assertAttackerNoProfit(
        address tokenAddr,
        address pair,
        uint256 preseedToken,
        uint256 preseedLT,
        CurveClose memory snap
    ) internal view {
        MockHyperswapPair p = MockHyperswapPair(pair);
        uint256 totalLP = p.totalSupply();
        uint256 attackerLP = p.balanceOf(attacker);
        if (totalLP == 0 || attackerLP == 0) return;

        (uint256 reserveToken, uint256 reserveLT) = _readReservesByToken(pair, tokenAddr);
        uint256 attackerTokenValue = (attackerLP * reserveToken) / totalLP;
        uint256 attackerLTValue = (attackerLP * reserveLT) / totalLP;

        // Convert TOKEN to LT via curve-close ratio.
        uint256 ltPerTokenX1e18 = snap.tokensForLP == 0 ? 0 : (snap.ltFromPair * 1e18) / snap.tokensForLP;
        uint256 attackerOutInLT = attackerLTValue + (attackerTokenValue * ltPerTokenX1e18) / 1e18;
        uint256 attackerInInLT = preseedLT + (preseedToken * ltPerTokenX1e18) / 1e18;

        uint256 maxAllowedOut = attackerInInLT + (attackerInInLT / 100);
        require(attackerOutInLT <= maxAllowedOut, "attacker LP value must not exceed pre-seed cost meaningfully");
    }
}
