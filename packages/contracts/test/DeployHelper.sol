// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {Factory} from "../src/Factory.sol";
import {Router} from "../src/Router.sol";
import {LPLock} from "../src/LPLock.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";
import {MockHyperswapRouter, MockHyperswapFactory} from "./mocks/MockHyperswapRouter.sol";
import {VanityMining} from "../src/lib/VanityMining.sol";

/// @notice Shared deployment wiring for Bonding-based test suites.
/// Deploys mocks, factory, router, LPLock proxy, Bonding proxy, and FeeVault proxy with roles configured.
/// Subclasses should call `_deployCore()` in their `setUp()` and then perform any additional setup.
abstract contract DeployHelper is Test {
    MockERC20 public usdc;
    MockLeveragedToken public lt;
    MockHyperswapRouter public hyperswapRouter;
    MockHyperswapFactory public hyperswapFactory;
    Factory public factory;
    Router public curveRouter;
    Bonding public bonding;
    LPLock public lpLockContract;
    FeeVault public feeVault;
    Token public tokenImpl;

    address public owner = address(this);
    address public feeReceiver = makeAddr("feeReceiver");
    address public creator = makeAddr("creator");
    address public trader = makeAddr("trader");
    address public trader2 = makeAddr("trader2");

    uint256 constant LT_EXCHANGE_RATE = 1 ether; // 1 LT = $1 USD

    /// @dev Per-test salt counter so successive `_mineVanitySalt` calls in
    ///      a single test pick up where the previous one left off. Tests
    ///      that build a `LaunchParams` literal directly must use
    ///      `_mineVanitySalt(creator_)` for the `salt` field — every
    ///      launched token must end in `Bonding.VANITY_SUFFIX` and the
    ///      contract reverts otherwise.
    uint256 internal _saltNonce;

    /// @dev Brute-force a `userSalt` such that
    ///      `Clones.cloneDeterministic(tokenImpl, _mixSalt(creator_, userSalt))`
    ///      deploys to an address ending in `Bonding.VANITY_SUFFIX`
    ///      (`0xa1fa`). Mirrors the off-chain Web Worker miner used by the
    ///      frontend. ~65k attempts on average — Foundry's revm runs this
    ///      in tens of ms per launch.
    ///
    ///      Non-view because we tick `_saltNonce` so successive launches in
    ///      a single test (with the same creator) get fresh starting points
    ///      and don't waste cycles re-mining the same range.
    function _mineVanitySalt(
        address creator_
    ) internal returns (bytes32) {
        // IMPORTANT: this helper must NOT make any external calls — the
        // calling test commonly does `vm.prank(creator); doStuff(_mineVanitySalt(...))`,
        // and any call here would consume the prank before `doStuff` runs.
        // We use the cached `tokenImpl` set at deploy time. Tests that
        // rotate `tokenImplementation` mid-test must call
        // `_mineVanitySaltForImpl(creator_, newImpl)` explicitly.
        return _mineVanitySaltForImpl(creator_, address(tokenImpl));
    }

    function _mineVanitySaltForImpl(
        address creator_,
        address implementation_
    ) internal returns (bytes32 found) {
        ++_saltNonce;
        bytes32 baseSalt = keccak256(abi.encode("vanity-mine-base", _saltNonce, creator_, implementation_));
        // `VanityMining.mine` is `internal pure` so the call inlines into
        // this function — no external call is made and any in-flight
        // `vm.prank` survives.
        found = VanityMining.mine(creator_, implementation_, address(bonding), baseSalt);
    }

    /// @notice Deploys all core contracts and wires roles. Does NOT allowlist any
    /// router on Bonding — callers must do that themselves (e.g. `bonding.addRouter(...)`).
    /// Suites that call `bonding.buy/sell/launch` directly should allowlist the
    /// pranked address as a router.
    function _deployCore() internal {
        usdc = new MockERC20("USD Coin", "USDC");
        lt = new MockLeveragedToken("HYPE 2x Long", "HYPE2L", LT_EXCHANGE_RATE, 2, true, "HYPE", address(usdc));
        hyperswapRouter = new MockHyperswapRouter();
        hyperswapFactory = MockHyperswapFactory(hyperswapRouter.factory());

        factory = new Factory();
        factory.initialize();

        curveRouter = new Router();
        curveRouter.initialize(address(factory));

        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (owner));
        lpLockContract = LPLock(address(new ERC1967Proxy(address(lpLockImpl), lpLockInit)));

        tokenImpl = new Token();

        Bonding bondingImpl = new Bonding();
        bytes memory bondingInit = abi.encodeCall(
            Bonding.initialize,
            (
                address(factory),
                address(curveRouter),
                address(hyperswapFactory),
                address(lpLockContract),
                address(tokenImpl)
            )
        );
        bonding = Bonding(address(new ERC1967Proxy(address(bondingImpl), bondingInit)));

        FeeVault feeVaultImpl = new FeeVault();
        bytes memory feeVaultInit = abi.encodeCall(FeeVault.initialize, (address(usdc), feeReceiver));
        feeVault = FeeVault(address(new ERC1967Proxy(address(feeVaultImpl), feeVaultInit)));

        factory.setRouter(address(curveRouter));
        factory.grantRole(factory.BONDING_ROLE(), address(bonding));
        curveRouter.grantRole(curveRouter.BONDING_ROLE(), address(bonding));
        lpLockContract.setLocker(address(bonding), true);
    }

    // ─── Config-scaled trade-size helpers ────────────────────────────────
    //
    // `Bonding.VIRTUAL_LIQUIDITY_USD` and `Bonding.graduationThresholdUsd`
    // are tuned periodically — every test should size its buys/seeds in
    // *USD* (or as a fraction of the threshold) and let these helpers do
    // the LT/USDC conversion. Hardcoding raw `N ether` of LT bakes in the
    // current `VIRTUAL_LIQUIDITY_USD` and silently breaks the moment the
    // dial moves: a "small" 200-LT seed at $4K virtual liquidity is a
    // curve-graduating monster at $100.

    /// @dev LT amount equivalent to `usd18dp` USD at the current
    ///      `lt.exchangeRate()`. Mirrors the on-chain conversion used by
    ///      `Bonding._virtualLtAtLaunch`.
    function _ltForUsd(
        uint256 usd18dp
    ) internal view returns (uint256) {
        return (usd18dp * 1 ether) / lt.exchangeRate();
    }

    /// @dev Initial virtual LT reserve at launch. Equal to the LT-denominated
    ///      value of `Bonding.VIRTUAL_LIQUIDITY_USD()` at the current
    ///      exchange rate.
    function _initialVirtualLt() internal view returns (uint256) {
        return _ltForUsd(bonding.VIRTUAL_LIQUIDITY_USD());
    }

    /// @dev Default seed buy used by test launch helpers. Sized as 5% of
    ///      opening virtual liquidity (in LT) so the seed never accidentally
    ///      pre-graduates the curve regardless of `VIRTUAL_LIQUIDITY_USD`.
    ///      A 5% seed leaves >95% of the curve's USD-headroom intact.
    function _defaultSeedLt() internal view returns (uint256) {
        return _initialVirtualLt() / 20;
    }

    /// @dev Standard "small" non-graduating buy: 25% of initial virtual LT.
    ///      At the test-suite-aligned threshold (3× virtual liquidity), this
    ///      moves real-LT-value to ~8% of threshold per buy — tiny relative
    ///      to graduation. Use for tests that exercise generic buy/sell
    ///      mechanics without intending to graduate.
    function _smallBuyLt() internal view returns (uint256) {
        return _initialVirtualLt() / 4;
    }

    /// @dev "Medium" non-graduating buy: ~75% of initial virtual LT.
    ///      ~25% of threshold post-alignment. Two of these still don't
    ///      graduate (only 50% of threshold). Use when a single small buy
    ///      isn't enough to expose the behaviour under test (e.g. price-
    ///      impact comparisons across two successive trades).
    function _mediumBuyLt() internal view returns (uint256) {
        return (_initialVirtualLt() * 3) / 4;
    }

    /// @dev Aligns `graduationThresholdUsd` to a fixed multiple of
    ///      `VIRTUAL_LIQUIDITY_USD`. Mirrors the production deploy/upgrade
    ///      scripts which keep the two roughly in proportion (currently
    ///      $300 threshold against $100 virt liquidity → 3×). Without this,
    ///      tests run against the contract default of $12K threshold which
    ///      can't be reached on a $100-virt-liquidity curve before the
    ///      supply trigger fires — making the USD graduation path
    ///      untestable. Suites that exercise graduation should call this
    ///      from `setUp()`.
    function _alignThresholdToVirtualLiquidity() internal {
        bonding.setGraduationThresholdUsd(bonding.VIRTUAL_LIQUIDITY_USD() * 3);
    }

    /// @dev LT buy that, applied to a fresh curve, pushes real-LT-value
    ///      ~10% over `graduationThresholdUsd` — enough margin to absorb
    ///      fee rounding while still triggering the USD graduation path.
    ///      Use when a test just needs the token to be graduated.
    function _ltToGraduate() internal view returns (uint256) {
        uint256 thresholdUsd = bonding.graduationThresholdUsd();
        return _ltForUsd(thresholdUsd + thresholdUsd / 10);
    }

    /// @dev Stage-1 LT amount for the "two-trade graduation via rate pump"
    ///      pattern: buys ~80% of the threshold's worth of LT at the
    ///      current rate, leaving room for a follow-up rate bump or a
    ///      small triggering trade to push over.
    function _ltStageBeforeGraduation() internal view returns (uint256) {
        uint256 thresholdUsd = bonding.graduationThresholdUsd();
        return _ltForUsd((thresholdUsd * 80) / 100);
    }

    /// @dev Tiny follow-up LT buy used as the *triggering trade* after
    ///      `_ltStageBeforeGraduation()` + a rate pump have already armed
    ///      graduation via `canGraduate()`. The contract only checks the
    ///      threshold inside `buy`/`sell`, so we need *some* trade to fire
    ///      `_checkAndGraduate` — but it needn't add meaningful value, and
    ///      keeping it small avoids draining the curve via the supply
    ///      trigger on small virtual-liquidity configurations.
    function _ltGraduationTrigger() internal view returns (uint256) {
        return _ltForUsd(1 ether); // $1 — enough to register, never enough to graduate alone
    }

    // ─── USDC-denominated trade-size helpers ─────────────────────────────
    //
    // Mock USDC in `_deployCore` uses the OZ default of 18 decimals, so a
    // raw USD amount and its 18-dp USDC representation are the same number.
    // These helpers compose the LT-side helpers above with the implicit
    // 1 USDC = $1 mapping so Zap-style suites can size buys in USDC space
    // without re-deriving the math. They scale with `VIRTUAL_LIQUIDITY_USD`
    // and `graduationThresholdUsd`, so they keep working as the dial moves.

    /// @dev Default seed USDC amount: 5% of opening virtual liquidity in USD.
    function _defaultSeedUsdc() internal view returns (uint256) {
        return bonding.VIRTUAL_LIQUIDITY_USD() / 20;
    }

    /// @dev "Small" non-graduating USDC buy: 25% of virtual liquidity USD.
    function _smallBuyUsdc() internal view returns (uint256) {
        return bonding.VIRTUAL_LIQUIDITY_USD() / 4;
    }

    /// @dev "Medium" non-graduating USDC buy: 75% of virtual liquidity USD.
    function _mediumBuyUsdc() internal view returns (uint256) {
        return (bonding.VIRTUAL_LIQUIDITY_USD() * 3) / 4;
    }

    /// @dev Stage-1 USDC amount mirroring `_ltStageBeforeGraduation`.
    function _usdcStageBeforeGraduation() internal view returns (uint256) {
        return (bonding.graduationThresholdUsd() * 80) / 100;
    }

    /// @dev Tiny USDC follow-up trade mirroring `_ltGraduationTrigger`.
    function _usdcGraduationTrigger() internal pure returns (uint256) {
        return 1 ether; // $1
    }

    /// @dev Exchange-rate bump that, together with `_ltStageBeforeGraduation()`
    ///      already in the pair, puts the real-LT × rate value comfortably
    ///      over `graduationThresholdUsd`. Staged amount sits at 80% of
    ///      threshold at the *current* rate, so we double the rate (160% of
    ///      threshold post-pump) for a clean buffer. Returns the absolute
    ///      rate to feed into `lt.setExchangeRate`.
    function _ratePumpForStagedGraduation() internal view returns (uint256) {
        return lt.exchangeRate() * 2;
    }
}
