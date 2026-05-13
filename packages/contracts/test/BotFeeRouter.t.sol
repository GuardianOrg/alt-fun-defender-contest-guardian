// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Bonding} from "../src/Bonding.sol";
import {Zap} from "../src/Zap.sol";
import {BotFeeRouter} from "../src/BotFeeRouter.sol";
import {IZap} from "../src/interfaces/IZap.sol";
import {DeployHelper} from "./DeployHelper.sol";

/// @notice Smart-contract surface tests for `BotFeeRouter`. Drives real
///         `Zap` + `Bonding` via the standard `DeployHelper` mock stack so
///         the fee/skim/referral split is exercised end-to-end.
contract BotFeeRouterTest is DeployHelper {
    Zap public zap;
    BotFeeRouter public router;

    address public treasury = makeAddr("treasury");
    Vm.Wallet internal signer;

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        _deployCore();

        Zap zapImpl = new Zap();
        bytes memory zapInit = abi.encodeCall(
            Zap.initialize, (address(bonding), address(usdc), address(hyperswapRouter), address(feeVault), 50, 50, 2000)
        );
        zap = Zap(address(new ERC1967Proxy(address(zapImpl), zapInit)));

        bonding.addRouter(address(zap));
        feeVault.addDepositor(address(zap));

        router = new BotFeeRouter(IZap(address(zap)), IERC20(address(usdc)), treasury);

        // Idle USDC for the BounceTech LT redeem buffer.
        usdc.mint(address(lt), 1_000_000 ether);

        signer = vm.createWallet("bot-user");
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchTokenSeeded() internal returns (address tokenAddr) {
        uint256 seed = _defaultSeedUsdc();
        usdc.mint(creator, seed);
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "BotTest",
            ticker: "BOT",
            description: "BotFeeRouter test token",
            image: "https://img.test/logo.png",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "BotTest", "BOT")
        });
        vm.startPrank(creator);
        usdc.approve(address(zap), seed);
        tokenAddr = zap.createToken(params, seed);
        vm.stopPrank();
        vm.roll(block.number + bonding.LAUNCH_TRADING_DELAY_BLOCKS() + 1);
    }

    function _signUsdcPermit(
        address owner_,
        uint256 privKey,
        address spender,
        uint256 value,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        IERC20Permit token = IERC20Permit(address(usdc));
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, token.nonces(owner_), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(privKey, digest);
    }

    function _signTokenPermit(
        address tokenAddr,
        address owner_,
        uint256 privKey,
        address spender,
        uint256 value,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        IERC20Permit token = IERC20Permit(tokenAddr);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, token.nonces(owner_), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(privKey, digest);
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    function test_constructor_rejectsZeroZap() public {
        vm.expectRevert(BotFeeRouter.ZeroAddress.selector);
        new BotFeeRouter(IZap(address(0)), IERC20(address(usdc)), treasury);
    }

    function test_constructor_rejectsZeroUsdc() public {
        vm.expectRevert(BotFeeRouter.ZeroAddress.selector);
        new BotFeeRouter(IZap(address(zap)), IERC20(address(0)), treasury);
    }

    function test_constructor_rejectsZeroTreasury() public {
        vm.expectRevert(BotFeeRouter.ZeroAddress.selector);
        new BotFeeRouter(IZap(address(zap)), IERC20(address(usdc)), address(0));
    }

    function test_constants_match_spec() public view {
        assertEq(router.VERSION(), "1.0.0", "deployed parameter set");
        assertEq(router.BOT_FEE_BPS(), 50, "0.5% bot fee");
        assertEq(router.REFERRER_SHARE_BPS(), 2000, "20% referrer share");
        assertEq(router.BPS_DENOM(), 10_000);
        assertEq(router.treasury(), treasury);
    }

    // ─── Buy ─────────────────────────────────────────────────────────────

    function test_buyWithBotFee_noReferrer_routesAllFeeToTreasury() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("user-noref");
        uint256 amount = 100 ether;
        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(router), amount);
        uint256 tokensOut = router.buyWithBotFee(tokenAddr, amount, 0, address(0));
        vm.stopPrank();

        uint256 expectedFee = (amount * 50) / 10_000;
        assertEq(usdc.balanceOf(treasury), expectedFee, "treasury receives full skim");
        assertGt(tokensOut, 0, "user got tokens");
        assertEq(IERC20(tokenAddr).balanceOf(user), tokensOut, "tokens delivered to user");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds no usdc");
        assertEq(IERC20(tokenAddr).balanceOf(address(router)), 0, "router holds no tokens");
    }

    function test_buyWithBotFee_withReferrer_splits20_80() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("user-ref");
        address referrer = makeAddr("referrer");
        uint256 amount = 100 ether;
        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(router), amount);
        router.buyWithBotFee(tokenAddr, amount, 0, referrer);
        vm.stopPrank();

        uint256 botFee = (amount * 50) / 10_000;
        uint256 expectedReferrerCut = (botFee * 2000) / 10_000;
        uint256 expectedTreasuryCut = botFee - expectedReferrerCut;

        assertEq(usdc.balanceOf(referrer), expectedReferrerCut, "referrer gets 20% of bot fee");
        assertEq(usdc.balanceOf(treasury), expectedTreasuryCut, "treasury gets 80% of bot fee");
    }

    function test_buyWithBotFee_selfReferral_allowed() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("user-self");
        uint256 amount = 100 ether;
        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(router), amount);
        router.buyWithBotFee(tokenAddr, amount, 0, user);
        vm.stopPrank();

        uint256 botFee = (amount * 50) / 10_000;
        uint256 expectedReferrerCut = (botFee * 2000) / 10_000;

        assertEq(usdc.balanceOf(user), expectedReferrerCut, "self-referrer gets the 20% cut on their own trade");
    }

    function test_buyWithBotFee_badReferrer_fallsBackToTreasury() public {
        address tokenAddr = _launchTokenSeeded();
        // Simulate a frozen referrer wallet — USDC.transfer to it reverts.
        // Foundry's `mockCallRevert` prefix-matches calldata, so this
        // intercepts every `transfer(bad, *)` regardless of amount.
        address bad = makeAddr("bad-referrer");
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, bad), "frozen");

        address user = makeAddr("user-bad-ref");
        uint256 amount = 100 ether;
        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(router), amount);
        router.buyWithBotFee(tokenAddr, amount, 0, bad);
        vm.stopPrank();

        uint256 botFee = (amount * 50) / 10_000;
        assertEq(usdc.balanceOf(bad), 0, "rejected referrer got nothing");
        assertEq(usdc.balanceOf(treasury), botFee, "treasury absorbed the full skim");
    }

    function test_buyWithBotFee_emitsBotRouterTrade() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("user-evt");
        address referrer = makeAddr("ref-evt");
        uint256 amount = 100 ether;
        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(router), amount);
        vm.recordLogs();
        router.buyWithBotFee(tokenAddr, amount, 0, referrer);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        vm.stopPrank();

        bytes32 sig = keccak256("BotRouterTrade(address,address,uint8,uint256,uint256,uint256,address,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) {
                found = true;
                assertEq(address(uint160(uint256(logs[i].topics[1]))), user, "trader topic");
                assertEq(address(uint160(uint256(logs[i].topics[2]))), tokenAddr, "token topic");
                assertEq(address(uint160(uint256(logs[i].topics[3]))), referrer, "referrer topic");
            }
        }
        assertTrue(found, "BotRouterTrade emitted");
    }

    function test_buyWithBotFee_slippage_forwardsToZap() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("user-slip");
        uint256 amount = 100 ether;
        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(router), amount);
        // Impossibly tight bound — must trip Zap.SlippageExceeded.
        vm.expectRevert(Zap.SlippageExceeded.selector);
        router.buyWithBotFee(tokenAddr, amount, type(uint256).max, address(0));
        vm.stopPrank();
    }

    // ─── Sell ────────────────────────────────────────────────────────────

    function test_sellWithBotFee_noReferrer_routesAllFeeToTreasury() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("seller-noref");

        // Seed user with tokens via a regular buy through the router.
        uint256 buyUsdc = 200 ether;
        usdc.mint(user, buyUsdc);
        vm.startPrank(user);
        usdc.approve(address(router), buyUsdc);
        uint256 tokensOwned = router.buyWithBotFee(tokenAddr, buyUsdc, 0, address(0));
        vm.stopPrank();
        uint256 treasuryAfterBuy = usdc.balanceOf(treasury);

        // Now sell half.
        uint256 sellAmount = tokensOwned / 2;
        vm.startPrank(user);
        IERC20(tokenAddr).approve(address(router), sellAmount);
        uint256 usdcOut = router.sellWithBotFee(tokenAddr, sellAmount, 0, address(0));
        vm.stopPrank();

        assertGt(usdcOut, 0, "user got usdc back");
        assertEq(IERC20(tokenAddr).balanceOf(address(router)), 0, "router holds no tokens after sell");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds no usdc after sell");
        assertGt(usdc.balanceOf(treasury), treasuryAfterBuy, "treasury accrued more on the sell");
    }

    function test_sellWithBotFee_withReferrer_splits20_80() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("seller-ref");
        address referrer = makeAddr("seller-referrer");

        uint256 buyUsdc = 200 ether;
        usdc.mint(user, buyUsdc);
        vm.startPrank(user);
        usdc.approve(address(router), buyUsdc);
        uint256 tokensOwned = router.buyWithBotFee(tokenAddr, buyUsdc, 0, address(0));
        IERC20(tokenAddr).approve(address(router), tokensOwned);
        vm.recordLogs();
        router.sellWithBotFee(tokenAddr, tokensOwned, 0, referrer);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        vm.stopPrank();

        // Decode the sell BotRouterTrade for the gross USDC + botFee + cuts.
        bytes32 sig = keccak256("BotRouterTrade(address,address,uint8,uint256,uint256,uint256,address,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) {
                (uint8 side,,, uint256 botFee, uint256 referrerCut, uint256 treasuryCut) =
                    abi.decode(logs[i].data, (uint8, uint256, uint256, uint256, uint256, uint256));
                if (side == 1) {
                    // Sell event
                    assertEq(referrerCut, (botFee * 2000) / 10_000, "referrer cut 20%");
                    assertEq(treasuryCut, botFee - referrerCut, "treasury cut remainder");
                    found = true;
                }
            }
        }
        assertTrue(found, "sell BotRouterTrade observed");
        assertGt(usdc.balanceOf(referrer), 0, "referrer received their cut");
    }

    function test_sellWithBotFee_badReferrer_fallsBackToTreasury() public {
        address tokenAddr = _launchTokenSeeded();
        address bad = makeAddr("seller-bad-ref");
        // Same prefix-match trick as the buy-side bad-referrer test.
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, bad), "frozen");

        address user = makeAddr("seller-badref-user");
        uint256 buyUsdc = 200 ether;
        usdc.mint(user, buyUsdc);
        vm.startPrank(user);
        usdc.approve(address(router), buyUsdc);
        uint256 tokensOwned = router.buyWithBotFee(tokenAddr, buyUsdc, 0, address(0));
        IERC20(tokenAddr).approve(address(router), tokensOwned);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        router.sellWithBotFee(tokenAddr, tokensOwned, 0, bad);
        vm.stopPrank();

        assertEq(usdc.balanceOf(bad), 0, "bad referrer got nothing");
        assertGt(usdc.balanceOf(treasury), treasuryBefore, "treasury absorbed the skim");
    }

    // ─── Permit ──────────────────────────────────────────────────────────

    function test_buyWithBotFeePermit_noPriorAllowance() public {
        address tokenAddr = _launchTokenSeeded();
        uint256 amount = 100 ether;
        usdc.mint(signer.addr, amount);

        (uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(signer.addr, signer.privateKey, address(router), amount, block.timestamp + 1 hours);

        vm.prank(signer.addr);
        uint256 tokensOut =
            router.buyWithBotFeePermit(tokenAddr, amount, 0, address(0), block.timestamp + 1 hours, v, r, s);

        assertGt(tokensOut, 0);
        assertEq(IERC20(tokenAddr).balanceOf(signer.addr), tokensOut);
    }

    function test_sellWithBotFeePermit_noPriorAllowance() public {
        address tokenAddr = _launchTokenSeeded();
        uint256 buyUsdc = 200 ether;
        usdc.mint(signer.addr, buyUsdc);
        vm.startPrank(signer.addr);
        usdc.approve(address(router), buyUsdc);
        uint256 tokensOwned = router.buyWithBotFee(tokenAddr, buyUsdc, 0, address(0));
        vm.stopPrank();

        (uint8 v, bytes32 r, bytes32 s) = _signTokenPermit(
            tokenAddr, signer.addr, signer.privateKey, address(router), tokensOwned, block.timestamp + 1 hours
        );

        vm.prank(signer.addr);
        uint256 usdcOut =
            router.sellWithBotFeePermit(tokenAddr, tokensOwned, 0, address(0), block.timestamp + 1 hours, v, r, s);

        assertGt(usdcOut, 0);
    }

    // ─── Reentrancy / sanity ─────────────────────────────────────────────

    /// @notice Regression: when `Zap._executeBuy` hits its floor-bump dust-cap
    ///         branch (a near-graduation buy where the curve can only absorb
    ///         `MIN_USDC_AMOUNT` worth of LT), it refunds the unused USDC and
    ///         LT excess to `msg.sender` — which is THIS router. Without the
    ///         post-buy sweep in `_buy`, those user-owed funds would sit in
    ///         the router forever. Asserts the sweep reaches the user and the
    ///         router ends at a zero balance on both assets.
    function test_buyWithBotFee_floorBump_refundsReachUser() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("floor-bump-user");

        // Stage the curve so the next buy is the cap-binding (graduation-
        // triggering) one. `_usdcStageBeforeGraduation` pre-fills ~80% of
        // threshold; the follow-up large buy then overshoots and trips the
        // dust-cap path.
        uint256 stage = _usdcStageBeforeGraduation();
        usdc.mint(user, stage);
        vm.startPrank(user);
        usdc.approve(address(router), stage);
        router.buyWithBotFee(tokenAddr, stage, 0, address(0));
        vm.stopPrank();

        // The overshoot buy — large enough to push past graduation, so the
        // curve consumes only a tiny chunk and Zap refunds the rest.
        uint256 overshoot = bonding.graduationThresholdUsd();
        usdc.mint(user, overshoot);
        uint256 userUsdcBefore = usdc.balanceOf(user);
        vm.startPrank(user);
        usdc.approve(address(router), overshoot);
        router.buyWithBotFee(tokenAddr, overshoot, 0, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(router)), 0, "router holds no usdc dust");
        assertEq(IERC20(address(lt)).balanceOf(address(router)), 0, "router holds no lt dust");
        // User should have received SOME refund back — strict equality is
        // hard to assert without re-deriving the curve math, but a positive
        // delta proves the sweep ran end-to-end.
        assertGt(usdc.balanceOf(user) + IERC20(address(lt)).balanceOf(user), 0, "user got refund");
        // Sanity: pre-buy balance was 0 (we minted exactly `overshoot`), so
        // the buy CANNOT have left more than `overshoot` worth in the user's
        // pocket via accidental double-refund.
        assertLt(usdc.balanceOf(user), userUsdcBefore, "user spent some usdc on the buy");
    }

    function test_buyWithBotFee_zeroAmount_reverts() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("zero-buyer");
        vm.prank(user);
        vm.expectRevert();
        router.buyWithBotFee(tokenAddr, 0, 0, address(0));
    }

    function test_sellWithBotFee_zeroAmount_reverts() public {
        address tokenAddr = _launchTokenSeeded();
        address user = makeAddr("zero-seller");
        vm.prank(user);
        vm.expectRevert();
        router.sellWithBotFee(tokenAddr, 0, 0, address(0));
    }
}
