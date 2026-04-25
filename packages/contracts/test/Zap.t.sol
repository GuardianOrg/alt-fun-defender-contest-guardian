// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {Zap} from "../src/Zap.sol";
import {DeployHelper} from "./DeployHelper.sol";

contract ZapV2 is Zap {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract ZapTest is DeployHelper {
    Zap public zap;

    address public referrer = makeAddr("referrer");

    function setUp() public {
        _deployCore();

        Zap zapImpl = new Zap();
        bytes memory zapInit = abi.encodeCall(
            Zap.initialize, (address(bonding), address(usdc), address(hyperswapRouter), address(feeVault), 50, 50, 2000)
        );
        zap = Zap(address(new ERC1967Proxy(address(zapImpl), zapInit)));

        bonding.addRouter(address(zap));
        feeVault.addDepositor(address(zap));

        usdc.mint(address(lt), 1_000_000 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _createToken(
        uint256 seedUsdc
    ) internal returns (address tokenAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "TestToken",
            ticker: "TEST",
            description: "A test token",
            image: "https://img.test/logo.png",
            urls: ["https://x.com/test", "", "", "https://test.com"],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });

        if (seedUsdc > 0) {
            usdc.mint(creator, seedUsdc);
            vm.startPrank(creator);
            usdc.approve(address(zap), seedUsdc);
            tokenAddr = zap.createToken(params, seedUsdc);
            vm.stopPrank();
        } else {
            vm.prank(creator);
            tokenAddr = zap.createToken(params, 0);
        }
    }

    function _buyViaRouter(
        address tokenAddr,
        address buyer,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut) {
        usdc.mint(buyer, usdcAmount);
        vm.startPrank(buyer);
        usdc.approve(address(zap), usdcAmount);
        tokensOut = zap.buy(tokenAddr, usdcAmount, 0, address(0));
        vm.stopPrank();
    }

    function _graduateToken(
        address tokenAddr
    ) internal {
        _buyViaRouter(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);
        _buyViaRouter(tokenAddr, trader2, 100 ether);
        assertTrue(bonding.isGraduated(tokenAddr), "Token should be graduated");
    }

    // ─── createToken Tests ───────────────────────────────────────────────

    function test_createToken_noSeedBuy() public {
        address tokenAddr = _createToken(0);
        assertTrue(tokenAddr != address(0));

        (address infoCreator,,,,,, bool trading, bool graduated) = bonding.tokenInfo(tokenAddr);
        assertEq(infoCreator, creator);
        assertTrue(trading);
        assertFalse(graduated);
    }

    function test_createToken_withSeedBuy() public {
        address tokenAddr = _createToken(200 ether);
        assertTrue(tokenAddr != address(0));

        uint256 creatorBalance = Token(tokenAddr).balanceOf(creator);
        assertTrue(creatorBalance > 0, "Creator should have tokens from seed buy");
    }

    function test_createToken_emitsTokenCreated() public {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "EventToken",
            ticker: "EVT",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });

        vm.expectEmit(false, true, false, false);
        emit Zap.TokenCreated(address(0), creator, address(lt));

        vm.prank(creator);
        zap.createToken(params, 0);
    }

    function test_createToken_revertsZeroLt() public {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "Bad",
            ticker: "BAD",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(0),
            salt: _mineVanitySalt(creator)
        });

        vm.prank(creator);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.createToken(params, 0);
    }

    // ─── Buy Tests (Curve) ───────────────────────────────────────────────

    function test_buy_curvePath_givesTokens() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        assertEq(Token(tokenAddr).balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0);
    }

    function test_buy_curvePath_deductsUsdc() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 500 ether);

        vm.startPrank(trader);
        usdc.approve(address(zap), 500 ether);
        zap.buy(tokenAddr, 500 ether, 0, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader), 0, "All USDC should be spent");
    }

    function test_buy_emitsBuyEvent() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(zap), 100 ether);

        vm.expectEmit(true, true, false, false);
        emit Zap.Buy(tokenAddr, trader, 100 ether, 0);
        zap.buy(tokenAddr, 100 ether, 0, address(0));
        vm.stopPrank();
    }

    function test_buy_revertsOnZeroAmount() public {
        address tokenAddr = _createToken(0);

        vm.prank(trader);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.buy(tokenAddr, 0, 0, address(0));
    }

    function test_buy_revertsOnSlippage() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(zap), 100 ether);
        vm.expectRevert(Zap.SlippageExceeded.selector);
        zap.buy(tokenAddr, 100 ether, type(uint256).max, address(0));
        vm.stopPrank();
    }

    // ─── Referral Tests ──────────────────────────────────────────────────

    function test_buy_emitsReferralEvent() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(zap), 100 ether);

        vm.expectEmit(true, true, true, true);
        emit Zap.Referred(tokenAddr, trader, referrer, 100 ether);
        zap.buy(tokenAddr, 100 ether, 0, referrer);
        vm.stopPrank();
    }

    function test_buy_noReferralEventForZeroAddress() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(zap), 100 ether);

        vm.recordLogs();
        zap.buy(tokenAddr, 100 ether, 0, address(0));
        vm.stopPrank();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 referredSig = keccak256("Referred(address,address,address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != referredSig, "Should not emit Referred for zero referrer");
        }
    }

    function test_buy_noReferralForSelfReferral() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(zap), 100 ether);

        vm.recordLogs();
        zap.buy(tokenAddr, 100 ether, 0, trader);
        vm.stopPrank();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 referredSig = keccak256("Referred(address,address,address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != referredSig, "Should not emit Referred for self-referral");
        }
    }

    // ─── Sell Tests (Curve) ──────────────────────────────────────────────

    function test_sell_curvePath_returnsUsdc() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut > 0, "Should receive USDC back");
        assertEq(usdc.balanceOf(trader), usdcOut);
    }

    function test_sell_curvePath_burnsTokens() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertEq(Token(tokenAddr).balanceOf(trader), 0, "All tokens should be sold");
    }

    function test_sell_emitsSellEvent() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);

        vm.expectEmit(true, true, false, false);
        emit Zap.Sell(tokenAddr, trader, tokensOut, 0);
        zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();
    }

    function test_sell_revertsOnZeroAmount() public {
        address tokenAddr = _createToken(0);

        vm.prank(trader);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.sell(tokenAddr, 0, 0);
    }

    // ─── Round Trip Tests ────────────────────────────────────────────────

    function test_roundTrip_traderLosesToFees() public {
        address tokenAddr = _createToken(0);
        uint256 usdcIn = 1000 ether;
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, usdcIn);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut < usdcIn, "Round trip should cost fees");
    }

    // ─── Post-Graduation Buy/Sell Tests ──────────────────────────────────

    function test_buy_postGrad_routesThroughHyperswap() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        uint256 tokensOut = _buyViaRouter(tokenAddr, makeAddr("postGradBuyer"), 100 ether);
        assertTrue(tokensOut > 0, "Post-grad buy should return tokens");
    }

    function test_sell_postGrad_routesThroughHyperswap() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        address seller = makeAddr("postGradSeller");
        uint256 tokensOut = _buyViaRouter(tokenAddr, seller, 100 ether);

        vm.startPrank(seller);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut > 0, "Post-grad sell should return USDC");
    }

    // ─── Admin Tests ─────────────────────────────────────────────────────

    function test_setBonding_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        zap.setBonding(address(1));
    }

    function test_setBonding_updatesValue() public {
        address newBonding = makeAddr("newBonding");
        zap.setBonding(newBonding);
        assertEq(address(zap.bonding()), newBonding);
    }

    function test_setBonding_revertsZeroAddress() public {
        vm.expectRevert(Zap.ZeroAddress.selector);
        zap.setBonding(address(0));
    }

    function test_setHyperswapRouter_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        zap.setHyperswapRouter(address(1));
    }

    function test_setHyperswapRouter_revertsZeroAddress() public {
        vm.expectRevert(Zap.ZeroAddress.selector);
        zap.setHyperswapRouter(address(0));
    }

    // ─── UUPS Upgrade ────────────────────────────────────────────────────

    function test_upgrade_ownerCanUpgrade() public {
        ZapV2 newImpl = new ZapV2();
        zap.upgradeToAndCall(address(newImpl), "");
        assertEq(ZapV2(address(zap)).version(), 2);
    }

    function test_upgrade_nonOwnerCannotUpgrade() public {
        ZapV2 newImpl = new ZapV2();

        vm.prank(trader);
        vm.expectRevert();
        zap.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_preservesState() public {
        address tokenAddr = _createToken(0);
        _buyViaRouter(tokenAddr, trader, 100 ether);

        ZapV2 newImpl = new ZapV2();
        zap.upgradeToAndCall(address(newImpl), "");

        assertEq(address(zap.bonding()), address(bonding));
        assertEq(address(zap.usdc()), address(usdc));
        assertEq(zap.owner(), owner);
    }

    // ─── Fee Tests ───────────────────────────────────────────────────────

    function test_buy_feeAccruesToVault() public {
        address tokenAddr = _createToken(0);
        uint256 usdcIn = 1000 ether;
        uint256 vaultBefore = usdc.balanceOf(address(feeVault));

        _buyViaRouter(tokenAddr, trader, usdcIn);

        uint256 expectedFee = (usdcIn * 50) / 10_000; // 0.5%
        uint256 vaultAfter = usdc.balanceOf(address(feeVault));
        assertEq(vaultAfter - vaultBefore, expectedFee, "FeeVault should hold the buy fee");

        uint256 creatorAccrual = feeVault.creatorBalance(creator);
        uint256 expectedCreator = (expectedFee * 2000) / 10_000; // 20% of fee
        assertEq(creatorAccrual, expectedCreator, "Creator share should be 20% of fee");
        assertEq(feeVault.protocolBalance(), expectedFee - expectedCreator, "Protocol share should be the remainder");
    }

    function test_sell_feeAccruesToVault() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 1000 ether);

        uint256 vaultBefore = usdc.balanceOf(address(feeVault));

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        // Fee is 0.5% of grossUsdc. usdcOut = grossUsdc - fee → fee = usdcOut * 50 / 9950.
        uint256 fee = (usdcOut * 50) / 9950;
        assertApproxEqAbs(usdc.balanceOf(address(feeVault)) - vaultBefore, fee, 1, "FeeVault should receive sell fee");
    }

    function test_createToken_seedBuy_feeAccruesToCreator() public {
        uint256 seedUsdc = 1000 ether;
        address tokenAddr = _createToken(seedUsdc);

        // Creator gets their own creator-share of the seed-buy fee back.
        uint256 expectedFee = (seedUsdc * 50) / 10_000;
        uint256 expectedCreator = (expectedFee * 2000) / 10_000;
        assertEq(feeVault.creatorBalance(creator), expectedCreator, "Seed buy should accrue creator-share to creator");
        assertEq(feeVault.lifetimeCreatorEarned(creator), expectedCreator, "Lifetime should match");
        assertEq(usdc.balanceOf(address(feeVault)), expectedFee, "Vault should hold full seed buy fee");
        assertTrue(tokenAddr != address(0));
    }

    function test_buy_postGrad_feeAccrues() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        uint256 vaultBefore = usdc.balanceOf(address(feeVault));
        uint256 usdcIn = 100 ether;
        _buyViaRouter(tokenAddr, makeAddr("postGradBuyer"), usdcIn);

        uint256 expectedFee = (usdcIn * 50) / 10_000;
        assertEq(
            usdc.balanceOf(address(feeVault)) - vaultBefore,
            expectedFee,
            "Post-grad buys must still accrue the same fee"
        );
    }

    function test_sell_postGrad_feeAccrues() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        address seller = makeAddr("postGradSeller");
        uint256 tokensOut = _buyViaRouter(tokenAddr, seller, 100 ether);
        uint256 vaultBefore = usdc.balanceOf(address(feeVault));

        vm.startPrank(seller);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        uint256 fee = (usdcOut * 50) / 9950;
        assertApproxEqAbs(
            usdc.balanceOf(address(feeVault)) - vaultBefore, fee, 1, "Post-grad sells must still accrue the same fee"
        );
    }

    function test_setFees_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        zap.setFees(100, 100, 3000);
    }

    function test_setFees_updatesValues() public {
        zap.setFees(30, 70, 1500);
        assertEq(zap.buyFeeBps(), 30);
        assertEq(zap.sellFeeBps(), 70);
        assertEq(zap.creatorFeeBps(), 1500);
    }

    function test_setFees_revertsAboveCap() public {
        vm.expectRevert(Zap.InvalidFee.selector);
        zap.setFees(201, 50, 2000);
    }

    function test_setFees_revertsCreatorAboveDenom() public {
        vm.expectRevert(Zap.InvalidFee.selector);
        zap.setFees(50, 50, 10_001);
    }

    function test_setFeeVault_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        zap.setFeeVault(makeAddr("new"));
    }

    function test_setFeeVault_revertsZeroAddress() public {
        vm.expectRevert(Zap.ZeroAddress.selector);
        zap.setFeeVault(address(0));
    }

    function test_setFeeVault_revertsIfRouterNotDepositor() public {
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(usdc), feeReceiver));
        FeeVault freshVault = FeeVault(address(new ERC1967Proxy(address(impl), init)));

        vm.expectRevert(Zap.VaultNotConfigured.selector);
        zap.setFeeVault(address(freshVault));
    }

    function test_setFeeVault_succeedsWhenDepositorAllowlisted() public {
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(usdc), feeReceiver));
        FeeVault freshVault = FeeVault(address(new ERC1967Proxy(address(impl), init)));
        freshVault.addDepositor(address(zap));

        zap.setFeeVault(address(freshVault));
        assertEq(address(zap.feeVault()), address(freshVault));
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_buy_curvePath(
        uint256 usdcAmount
    ) public {
        usdcAmount = bound(usdcAmount, 10 ether, 5000 ether);
        address tokenAddr = _createToken(0);

        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, usdcAmount);
        assertTrue(tokensOut > 0, "Should always receive tokens");
    }

    function testFuzz_roundTrip_neverProfits(
        uint256 usdcAmount
    ) public {
        usdcAmount = bound(usdcAmount, 10 ether, 3000 ether);
        address tokenAddr = _createToken(0);

        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, usdcAmount);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut <= usdcAmount, "Should never profit on round trip through router");
    }
}
