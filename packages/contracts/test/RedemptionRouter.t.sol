// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bonding} from "../src/Bonding.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {FERC20} from "../src/FERC20.sol";
import {LPLock} from "../src/LPLock.sol";
import {RedemptionRouter} from "../src/RedemptionRouter.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";
import {MockHyperswapRouter} from "./mocks/MockHyperswapRouter.sol";

contract RedemptionRouterV2 is RedemptionRouter {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract RedemptionRouterTest is Test {
    MockERC20 public usdc;
    MockLeveragedToken public lt;
    MockHyperswapRouter public hyperswapRouter;
    FFactory public factory;
    FRouter public frouter;
    Bonding public bonding;
    LPLock public lpLockContract;
    RedemptionRouter public redemptionRouter;

    address public owner = address(this);
    address public feeReceiver = makeAddr("feeReceiver");
    address public creator = makeAddr("creator");
    address public trader = makeAddr("trader");
    address public trader2 = makeAddr("trader2");
    address public referrer = makeAddr("referrer");

    uint256 constant BUY_TAX_BPS = 50;
    uint256 constant SELL_TAX_BPS = 50;
    uint256 constant MAX_TX = 100;
    uint256 constant LT_EXCHANGE_RATE = 1 ether;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        lt = new MockLeveragedToken("HYPE 2x Long", "HYPE2L", LT_EXCHANGE_RATE, 2, true, "HYPE", address(usdc));
        hyperswapRouter = new MockHyperswapRouter();

        factory = new FFactory();
        factory.initialize(feeReceiver, BUY_TAX_BPS, SELL_TAX_BPS);

        frouter = new FRouter();
        frouter.initialize(address(factory));

        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (owner));
        lpLockContract = LPLock(address(new ERC1967Proxy(address(lpLockImpl), lpLockInit)));

        Bonding bondingImpl = new Bonding();
        bytes memory bondingInit = abi.encodeCall(
            Bonding.initialize,
            (address(factory), address(frouter), feeReceiver, MAX_TX, address(hyperswapRouter), address(lpLockContract))
        );
        bonding = Bonding(address(new ERC1967Proxy(address(bondingImpl), bondingInit)));

        RedemptionRouter routerImpl = new RedemptionRouter();
        bytes memory routerInit =
            abi.encodeCall(RedemptionRouter.initialize, (address(bonding), address(usdc), address(hyperswapRouter)));
        redemptionRouter = RedemptionRouter(address(new ERC1967Proxy(address(routerImpl), routerInit)));

        factory.setRouter(address(frouter));
        factory.grantRole(factory.BONDING_ROLE(), address(bonding));
        frouter.grantRole(frouter.BONDING_ROLE(), address(bonding));
        lpLockContract.setLocker(address(bonding), true);
        bonding.setRedemptionRouter(address(redemptionRouter));
        factory.setFeeParams(address(bonding), BUY_TAX_BPS, SELL_TAX_BPS);

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
            purchaseAmount: 0
        });

        if (seedUsdc > 0) {
            usdc.mint(creator, seedUsdc);
            vm.startPrank(creator);
            usdc.approve(address(redemptionRouter), seedUsdc);
            tokenAddr = redemptionRouter.createToken(params, seedUsdc);
            vm.stopPrank();
        } else {
            vm.prank(creator);
            tokenAddr = redemptionRouter.createToken(params, 0);
        }
    }

    function _buyViaRouter(
        address tokenAddr,
        address buyer,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut) {
        usdc.mint(buyer, usdcAmount);
        vm.startPrank(buyer);
        usdc.approve(address(redemptionRouter), usdcAmount);
        tokensOut = redemptionRouter.buy(tokenAddr, usdcAmount, 0, block.timestamp + 300, address(0));
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

        uint256 creatorBalance = FERC20(tokenAddr).balanceOf(creator);
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
            purchaseAmount: 0
        });

        vm.expectEmit(false, true, false, false);
        emit RedemptionRouter.TokenCreated(address(0), creator, address(lt));

        vm.prank(creator);
        redemptionRouter.createToken(params, 0);
    }

    function test_createToken_revertsZeroLt() public {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "Bad",
            ticker: "BAD",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(0),
            purchaseAmount: 0
        });

        vm.prank(creator);
        vm.expectRevert(RedemptionRouter.InvalidInput.selector);
        redemptionRouter.createToken(params, 0);
    }

    // ─── Buy Tests (Curve) ───────────────────────────────────────────────

    function test_buy_curvePath_givesTokens() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        assertEq(FERC20(tokenAddr).balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0);
    }

    function test_buy_curvePath_deductsUsdc() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 500 ether);

        vm.startPrank(trader);
        usdc.approve(address(redemptionRouter), 500 ether);
        redemptionRouter.buy(tokenAddr, 500 ether, 0, block.timestamp + 300, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader), 0, "All USDC should be spent");
    }

    function test_buy_emitsBuyEvent() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(redemptionRouter), 100 ether);

        vm.expectEmit(true, true, false, false);
        emit RedemptionRouter.Buy(tokenAddr, trader, 100 ether, 0);
        redemptionRouter.buy(tokenAddr, 100 ether, 0, block.timestamp + 300, address(0));
        vm.stopPrank();
    }

    function test_buy_revertsOnZeroAmount() public {
        address tokenAddr = _createToken(0);

        vm.prank(trader);
        vm.expectRevert(RedemptionRouter.InvalidInput.selector);
        redemptionRouter.buy(tokenAddr, 0, 0, block.timestamp + 300, address(0));
    }

    function test_buy_revertsOnExpiredDeadline() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(redemptionRouter), 100 ether);
        vm.expectRevert(RedemptionRouter.DeadlineExpired.selector);
        redemptionRouter.buy(tokenAddr, 100 ether, 0, block.timestamp - 1, address(0));
        vm.stopPrank();
    }

    function test_buy_revertsOnSlippage() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(redemptionRouter), 100 ether);
        vm.expectRevert(RedemptionRouter.SlippageExceeded.selector);
        redemptionRouter.buy(tokenAddr, 100 ether, type(uint256).max, block.timestamp + 300, address(0));
        vm.stopPrank();
    }

    // ─── Referral Tests ──────────────────────────────────────────────────

    function test_buy_emitsReferralEvent() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(redemptionRouter), 100 ether);

        vm.expectEmit(true, true, true, true);
        emit RedemptionRouter.Referred(tokenAddr, trader, referrer, 100 ether);
        redemptionRouter.buy(tokenAddr, 100 ether, 0, block.timestamp + 300, referrer);
        vm.stopPrank();
    }

    function test_buy_noReferralEventForZeroAddress() public {
        address tokenAddr = _createToken(0);
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(redemptionRouter), 100 ether);

        vm.recordLogs();
        redemptionRouter.buy(tokenAddr, 100 ether, 0, block.timestamp + 300, address(0));
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
        usdc.approve(address(redemptionRouter), 100 ether);

        vm.recordLogs();
        redemptionRouter.buy(tokenAddr, 100 ether, 0, block.timestamp + 300, trader);
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
        FERC20(tokenAddr).approve(address(redemptionRouter), tokensOut);
        uint256 usdcOut = redemptionRouter.sell(tokenAddr, tokensOut, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(usdcOut > 0, "Should receive USDC back");
        assertEq(usdc.balanceOf(trader), usdcOut);
    }

    function test_sell_curvePath_burnsTokens() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(redemptionRouter), tokensOut);
        redemptionRouter.sell(tokenAddr, tokensOut, 0, block.timestamp + 300);
        vm.stopPrank();

        assertEq(FERC20(tokenAddr).balanceOf(trader), 0, "All tokens should be sold");
    }

    function test_sell_emitsSellEvent() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(redemptionRouter), tokensOut);

        vm.expectEmit(true, true, false, false);
        emit RedemptionRouter.Sell(tokenAddr, trader, tokensOut, 0);
        redemptionRouter.sell(tokenAddr, tokensOut, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_sell_revertsOnZeroAmount() public {
        address tokenAddr = _createToken(0);

        vm.prank(trader);
        vm.expectRevert(RedemptionRouter.InvalidInput.selector);
        redemptionRouter.sell(tokenAddr, 0, 0, block.timestamp + 300);
    }

    function test_sell_revertsOnExpiredDeadline() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(redemptionRouter), tokensOut);
        vm.expectRevert(RedemptionRouter.DeadlineExpired.selector);
        redemptionRouter.sell(tokenAddr, tokensOut, 0, block.timestamp - 1);
        vm.stopPrank();
    }

    // ─── Round Trip Tests ────────────────────────────────────────────────

    function test_roundTrip_traderLosesToFees() public {
        address tokenAddr = _createToken(0);
        uint256 usdcIn = 1000 ether;
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, usdcIn);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(redemptionRouter), tokensOut);
        uint256 usdcOut = redemptionRouter.sell(tokenAddr, tokensOut, 0, block.timestamp + 300);
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
        FERC20(tokenAddr).approve(address(redemptionRouter), tokensOut);
        uint256 usdcOut = redemptionRouter.sell(tokenAddr, tokensOut, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(usdcOut > 0, "Post-grad sell should return USDC");
    }

    // ─── Admin Tests ─────────────────────────────────────────────────────

    function test_setBonding_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        redemptionRouter.setBonding(address(1));
    }

    function test_setBonding_updatesValue() public {
        address newBonding = makeAddr("newBonding");
        redemptionRouter.setBonding(newBonding);
        assertEq(address(redemptionRouter.bonding()), newBonding);
    }

    function test_setBonding_revertsZeroAddress() public {
        vm.expectRevert(RedemptionRouter.ZeroAddress.selector);
        redemptionRouter.setBonding(address(0));
    }

    function test_setHyperswapRouter_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        redemptionRouter.setHyperswapRouter(address(1));
    }

    function test_setHyperswapRouter_revertsZeroAddress() public {
        vm.expectRevert(RedemptionRouter.ZeroAddress.selector);
        redemptionRouter.setHyperswapRouter(address(0));
    }

    // ─── UUPS Upgrade ────────────────────────────────────────────────────

    function test_upgrade_ownerCanUpgrade() public {
        RedemptionRouterV2 newImpl = new RedemptionRouterV2();
        redemptionRouter.upgradeToAndCall(address(newImpl), "");
        assertEq(RedemptionRouterV2(address(redemptionRouter)).version(), 2);
    }

    function test_upgrade_nonOwnerCannotUpgrade() public {
        RedemptionRouterV2 newImpl = new RedemptionRouterV2();

        vm.prank(trader);
        vm.expectRevert();
        redemptionRouter.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_preservesState() public {
        address tokenAddr = _createToken(0);
        _buyViaRouter(tokenAddr, trader, 100 ether);

        RedemptionRouterV2 newImpl = new RedemptionRouterV2();
        redemptionRouter.upgradeToAndCall(address(newImpl), "");

        assertEq(address(redemptionRouter.bonding()), address(bonding));
        assertEq(address(redemptionRouter.usdc()), address(usdc));
        assertEq(redemptionRouter.owner(), owner);
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
        FERC20(tokenAddr).approve(address(redemptionRouter), tokensOut);
        uint256 usdcOut = redemptionRouter.sell(tokenAddr, tokensOut, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(usdcOut <= usdcAmount, "Should never profit on round trip through router");
    }
}
