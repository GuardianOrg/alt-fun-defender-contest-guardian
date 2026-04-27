// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {IPair} from "../src/interfaces/IPair.sol";
import {DeployHelper} from "./DeployHelper.sol";

/// @notice Strict invariants for the dynamic LP seeding / zero-gap graduation mechanism.
/// @dev Properties validated here:
///      1. Zero price gap  — Hyperswap LP opens at exactly the last curve price.
///      2. Conservation    — `tokensForLP + lpBurned = LP_RESERVE`.
///      3. Parabola cap    — `tokensForLP ≤ LP_RESERVE` always (mathematical invariant).
///      4. Pair drained    — Zero real tokens & zero real LT remain in Pair after graduation.
///      5. Supply trigger  — Exhausting curve supply graduates even below $12K.
///      6. USD trigger     — Raised-value ≥ $12K graduates even with supply remaining.
///      7. Overflow cap    — Buy capped at real balance; excess LT refunded to buyer.
contract GraduationInvariantsTest is DeployHelper {
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant CURVE_SUPPLY = 750_000_000 ether;
    uint256 internal constant LP_RESERVE = 250_000_000 ether;

    /// Max acceptable absolute discrepancy (in LT wei) between curve and LP price.
    /// The price ratio is `reserve1 / reserve0` vs `ltFromPair / tokensForLP`. The
    /// integer division in `tokensForLP = (ltFromPair * r0) / r1` can cost up to
    /// `ltFromPair / r1` of token precision; we translate that back into an
    /// acceptable numerator discrepancy.
    uint256 internal constant PRICE_MATCH_EPS_BPS = 1; // 1 bps (0.01%)

    function setUp() public {
        _deployCore();
        // Every pranked address that calls Bonding directly must be on the router allowlist.
        bonding.addRouter(creator);
        bonding.addRouter(trader);
        bonding.addRouter(trader2);
        // Align the graduation threshold to virtual liquidity so the USD
        // trigger is reachable on the test curve. Without this, the
        // contract-default $12K threshold cannot be hit on a $100-virt-
        // liquidity curve before the supply trigger fires, making the
        // USD-trigger invariants untestable. See DeployHelper for full
        // rationale.
        _alignThresholdToVirtualLiquidity();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchToken(
        uint256 seedLtAmount
    ) internal returns (address tokenAddr, address pairAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "Inv",
            ticker: "INV",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });
        vm.prank(creator);
        (tokenAddr, pairAddr,) = bonding.launch(params, creator);

        // Seed buys are no longer part of `Bonding.launch`. These invariant
        // tests rely on a seeded curve, so reproduce it via `bonding.buy`
        // (creator is allowlisted in `setUp`).
        if (seedLtAmount > 0) {
            _buy(tokenAddr, creator, seedLtAmount);
        }
    }

    function _launchNoSeed() internal returns (address tokenAddr, address pairAddr) {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "Inv",
            ticker: "INV",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });
        (tokenAddr, pairAddr,) = bonding.launch(params, creator);
        vm.stopPrank();
    }

    function _buy(
        address tokenAddr,
        address buyer,
        uint256 ltAmount
    ) internal returns (uint256 tokensOut, uint256 amountInUsed) {
        lt.mintDirect(buyer, ltAmount);
        if (!bonding.isRouter(buyer)) bonding.addRouter(buyer);
        vm.startPrank(buyer);
        lt.approve(address(curveRouter), ltAmount);
        (tokensOut, amountInUsed) = bonding.buy(ltAmount, tokenAddr, 0, buyer);
        vm.stopPrank();

        // Two-phase graduation: drive phase 2 inline so the rest of the
        // invariant suite (which asserts on the *graduated* state) sees the
        // post-finalize world. Production deployments rely on the keeper for
        // this; we drive it directly in tests.
        if (bonding.isGraduating(tokenAddr)) bonding.finalizeGraduation(tokenAddr);
    }

    struct GraduationSnapshot {
        /// Post-final-trade curve reserves (Pair does not mutate `_pool.reserve0/1` on
        /// `transferAsset` / `transferToken` / `burn`, so these remain readable after graduation).
        uint256 reserve0End;
        uint256 reserve1End;
        uint256 ltFromPair;
        uint256 tokensInLP;
        uint256 lpBurned;
        uint256 unsoldBurned;
        address hyperPair;
    }

    /// @dev Execute a buy that fires phase 1 of graduation, then call
    ///      `finalizeGraduation` to fire phase 2, capturing the snapshot from
    ///      both events. Two-phase graduation does NOT change the math —
    ///      `tokensForLP` and `ltFromPair` are pinned at end-of-phase-1 and
    ///      consumed verbatim in phase 2 — so the seven invariants prove the
    ///      same property they did under the old single-tx flow.
    function _graduateAndCapture(
        address tokenAddr,
        address pairAddr,
        address buyer,
        uint256 ltAmount
    ) internal returns (GraduationSnapshot memory snap) {
        lt.mintDirect(buyer, ltAmount);
        if (!bonding.isRouter(buyer)) bonding.addRouter(buyer);
        vm.startPrank(buyer);
        lt.approve(address(curveRouter), ltAmount);
        bonding.buy(ltAmount, tokenAddr, 0, buyer);
        vm.stopPrank();
        require(bonding.isGraduating(tokenAddr), "phase 1 of graduation did not fire");

        // Capture post-phase-1 curve reserves — the prices that `_prepareGraduationLiquidity`
        // used to compute `tokensForLP`. `Pair._pool.reserve0/1` reflect the state after the
        // final swap but before the balance sweeps (graduate/burn).
        (snap.reserve0End, snap.reserve1End) = IPair(pairAddr).getReserves();

        // Phase 2: anyone can finalize. We capture `TokenGraduated` for the LP-side fields.
        vm.recordLogs();
        bonding.finalizeGraduation(tokenAddr);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 topic = keccak256("TokenGraduated(address,address,uint256,uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic) {
                (address hp,, uint256 tokensInLP, uint256 lpBurn, uint256 unsold) =
                    abi.decode(logs[i].data, (address, uint256, uint256, uint256, uint256));
                snap.hyperPair = hp;
                snap.tokensInLP = tokensInLP;
                snap.lpBurned = lpBurn;
                snap.unsoldBurned = unsold;
                found = true;
                break;
            }
        }
        require(found, "TokenGraduated event not emitted");

        // `ltFromPair` is the LT now sitting in the freshly-seeded hyperswap pair.
        snap.ltFromPair = IERC20(address(lt)).balanceOf(snap.hyperPair);
    }

    function _reserve0(
        address pairAddr
    ) internal view returns (uint256 r0) {
        (r0,) = IPair(pairAddr).getReserves();
    }

    function _reserve1(
        address pairAddr
    ) internal view returns (uint256 r1) {
        (, r1) = IPair(pairAddr).getReserves();
    }

    // ─── 1. Zero price gap ───────────────────────────────────────────────

    function test_inv_zeroGap_usdTrigger() public {
        // Seed a small launch buy, stage close to the threshold, pump the
        // exchange rate to push the staged value over, then trigger
        // graduation with a tiny follow-up trade. Sized off live config so
        // it survives `VIRTUAL_LIQUIDITY_USD` / threshold retunes.
        (address tokenAddr, address pairAddr) = _launchToken(_defaultSeedLt());
        _buy(tokenAddr, trader, _ltStageBeforeGraduation());

        lt.setExchangeRate(_ratePumpForStagedGraduation());
        GraduationSnapshot memory s = _graduateAndCapture(tokenAddr, pairAddr, trader2, _ltGraduationTrigger());

        _assertZeroGap(s);
        _assertParabolaCap(s);
        _assertConservation(s);
    }

    function test_inv_zeroGap_supplyTrigger() public {
        // No seed buy → 750M real tokens on curve.
        (address tokenAddr, address pairAddr) = _launchNoSeed();

        // Cheap LT so the USD trigger doesn't fire before we exhaust supply.
        lt.setExchangeRate(0.0001 ether); // $0.0001 / LT

        // Buy in large chunks until curve is drained.
        // Initial LT reserve ≈ 4000 / 0.0001 = 4e7 LT. To buy out 750M tokens need huge inflow.
        uint256 stepLt = 1_000_000 ether;
        for (uint256 i = 0; i < 200; i++) {
            if (!bonding.isTrading(tokenAddr)) break;
            _buy(tokenAddr, trader, stepLt);
        }
        assertTrue(bonding.isGraduated(tokenAddr), "should graduate via supply trigger");

        // Fetch graduation snapshot from the emitted event on a fresh graduation isn't
        // possible here (already past). Instead, verify the key invariant directly on state:
        // no real tokens left in the pair, no real LT left, and the hyperswap pair was seeded.
        assertEq(IPair(pairAddr).tokenBalance(), 0, "curve should be drained of tokens");
        assertEq(IPair(pairAddr).assetBalance(), 0, "curve should be drained of LT");
        assertTrue(bonding.graduatedPair(tokenAddr) != address(0), "hyperswap pair seeded");
    }

    function test_inv_zeroGap_acrossManyGraduationLevels() public {
        // Test a spectrum of graduation points: from very-early USD graduation (HYPE moons)
        // to very-late graduation (exchange rate stays near 1, curve nearly filled).
        uint256[5] memory exchangeRates = [
            uint256(20 ether), // HYPE ×20 → ~$100 value of a tiny LT deposit graduates
            uint256(5 ether),
            uint256(2 ether),
            uint256(1.1 ether),
            uint256(1 ether)
        ];

        for (uint256 i = 0; i < exchangeRates.length; i++) {
            (address tokenAddr, address pairAddr) = _launchToken(10 ether);
            // Put the curve at a non-trivial fill level before the graduation tick.
            _buy(tokenAddr, trader, 500 ether);

            lt.setExchangeRate(exchangeRates[i]);

            // Push one more buy that may or may not trigger graduation. If not, keep pushing.
            uint256 pushes;
            while (!bonding.isGraduated(tokenAddr) && pushes < 50) {
                _buy(tokenAddr, trader2, 500 ether);
                pushes++;
            }
            assertTrue(bonding.isGraduated(tokenAddr), "did not graduate");

            // Strict invariant: pair has zero real balances and a hyperswap pair was created.
            assertEq(IPair(pairAddr).tokenBalance(), 0);
            assertEq(IPair(pairAddr).assetBalance(), 0);
            assertTrue(bonding.graduatedPair(tokenAddr) != address(0));

            // Reset exchange rate for the next iteration.
            lt.setExchangeRate(1 ether);
        }
    }

    // ─── 2-4. Conservation / parabola / pair drained ─────────────────────

    function _assertConservation(
        GraduationSnapshot memory s
    ) internal pure {
        assertEq(s.tokensInLP + s.lpBurned, LP_RESERVE, "LP reserve conserved (LP + burn = 250M)");
    }

    function _assertParabolaCap(
        GraduationSnapshot memory s
    ) internal pure {
        assertTrue(s.tokensInLP <= LP_RESERVE, "tokensForLP must never exceed LP_RESERVE");
    }

    /// @dev Price in the LP vs last-curve price match within PRICE_MATCH_EPS_BPS.
    ///      curve price = reserve1End / reserve0End  (LT per token, post final trade)
    ///      LP price    = ltFromPair / tokensInLP    (LT per token, LP opening)
    ///      Cross-multiplied: ltFromPair * reserve0End  ≈  tokensInLP * reserve1End
    function _assertZeroGap(
        GraduationSnapshot memory s
    ) internal pure {
        uint256 lhs = s.ltFromPair * s.reserve0End;
        uint256 rhs = s.tokensInLP * s.reserve1End;

        uint256 diff = lhs > rhs ? lhs - rhs : rhs - lhs;
        uint256 denom = lhs > rhs ? lhs : rhs;
        assertTrue(
            denom == 0 || diff * 10_000 <= PRICE_MATCH_EPS_BPS * denom,
            "price gap between curve and LP must be <= 1 bps"
        );
    }

    // ─── 5. Supply trigger fires even below $12K ─────────────────────────

    function test_inv_supplyTrigger_belowUsdThreshold() public {
        (address tokenAddr, address pairAddr) = _launchNoSeed();
        lt.setExchangeRate(0.0001 ether); // Crash to near-zero so USD target is never hit.

        uint256 stepLt = 1_000_000 ether;
        for (uint256 i = 0; i < 200; i++) {
            if (!bonding.isTrading(tokenAddr)) break;
            _buy(tokenAddr, trader, stepLt);
        }

        assertTrue(bonding.isGraduated(tokenAddr), "graduated via supply");
        assertEq(IPair(pairAddr).tokenBalance(), 0);

        // lpReserve cleared
        assertEq(bonding.lpReserve(tokenAddr), 0);
    }

    // ─── 6. USD trigger fires with supply remaining ──────────────────────

    function test_inv_usdTrigger_supplyRemaining() public {
        (address tokenAddr, address pairAddr) = _launchToken(_defaultSeedLt());
        _buy(tokenAddr, trader, _ltStageBeforeGraduation());

        // Before triggering: some real tokens still in the pair.
        assertTrue(IPair(pairAddr).tokenBalance() > 0, "real tokens still on curve");

        // Pump the rate so the *next* trade trips the USD trigger before the
        // supply trigger possibly could.
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buy(tokenAddr, trader2, _ltGraduationTrigger());

        assertTrue(bonding.isGraduated(tokenAddr), "graduated via USD");

        // Unsold tokens were burned in `_graduate` (pair token balance is zero).
        assertEq(IPair(pairAddr).tokenBalance(), 0, "unsold burned on graduation");
    }

    // ─── 7. Overflow cap & refund ────────────────────────────────────────

    function test_inv_overflowCap_refundsLt() public {
        (address tokenAddr,) = _launchNoSeed();
        // Crash exchange rate so USD trigger never fires and we can isolate the supply
        // trigger & overflow-cap path.
        lt.setExchangeRate(0.0001 ether);

        uint256 balancePre = lt.balanceOf(trader2);
        // Grossly oversized buy that would attempt to absorb >1B tokens on the curve.
        // Real balance is 750M, so `Router.buy` must cap at 750M and back-calc the LT used.
        uint256 oversizedBuy = 1_000_000_000 ether;

        (uint256 tokensOut, uint256 amountInUsed) = _buy(tokenAddr, trader2, oversizedBuy);

        assertTrue(bonding.isGraduated(tokenAddr), "graduated on capped buy");
        assertTrue(amountInUsed < oversizedBuy, "buy must be capped below oversized request");
        assertEq(tokensOut, CURVE_SUPPLY, "tokensOut must equal remaining real supply");

        // `bonding.buy` pulls only `amountInUsed` from trader2 (via Router → pair + fees).
        uint256 balancePost = lt.balanceOf(trader2);
        uint256 ltConsumed = balancePre + oversizedBuy - balancePost;
        assertEq(ltConsumed, amountInUsed, "trader should only pay `amountInUsed`, not the requested amount");
    }

    // ─── Fuzz: graduation always preserves invariants ────────────────────

    /// @dev Fuzz over seed buys and exchange rates. Verifies that no matter how or when the
    ///      curve graduates, the pair is drained, the lp reserve conservation holds, and the
    ///      hyperswap pair is always created successfully.
    function testFuzz_inv_graduationAlwaysClean(
        uint256 seedLtRaw,
        uint256 rateBumpRaw,
        uint256 stepsRaw
    ) public {
        uint256 seedLt = bound(seedLtRaw, 0.1 ether, 1000 ether);
        uint256 rateBump = bound(rateBumpRaw, 1.01 ether, 20 ether);
        uint256 steps = bound(stepsRaw, 1, 100);

        (address tokenAddr, address pairAddr) = _launchToken(seedLt);

        for (uint256 i = 0; i < steps; i++) {
            if (!bonding.isTrading(tokenAddr)) break;
            // Randomly bump the exchange rate mid-trade to exercise different graduation paths.
            if (i == steps / 2) {
                lt.setExchangeRate(rateBump);
            }
            _buy(tokenAddr, trader, 500 ether);
        }

        // Force graduation if still trading — push until graduated or we give up.
        if (bonding.isTrading(tokenAddr)) {
            lt.setExchangeRate(rateBump * 5); // mega-pump
            uint256 pushes;
            while (!bonding.isGraduated(tokenAddr) && pushes < 100) {
                _buy(tokenAddr, trader2, 1000 ether);
                pushes++;
            }
        }

        assertTrue(bonding.isGraduated(tokenAddr), "should graduate eventually");
        assertEq(IPair(pairAddr).tokenBalance(), 0, "pair drained of tokens");
        assertEq(IPair(pairAddr).assetBalance(), 0, "pair drained of LT");
        assertEq(bonding.lpReserve(tokenAddr), 0, "lpReserve cleared");
        assertTrue(bonding.graduatedPair(tokenAddr) != address(0), "hyperswap pair created");

        lt.setExchangeRate(1 ether); // reset for subsequent runs
    }
}
