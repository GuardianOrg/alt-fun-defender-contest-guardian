// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bonding} from "../src/Bonding.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {LPLock} from "../src/LPLock.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";
import {MockHyperswapRouter} from "./mocks/MockHyperswapRouter.sol";

contract BondingV2 is Bonding {
    uint256 public newSlot;

    function version() external pure returns (uint256) {
        return 2;
    }

    function setNewSlot(
        uint256 val
    ) external {
        newSlot = val;
    }
}

contract UUPSUpgradeTest is Test {
    MockERC20 public usdc;
    MockLeveragedToken public lt;
    MockHyperswapRouter public hyperswapRouter;
    FFactory public factory;
    FRouter public router;
    Bonding public bonding;
    LPLock public lpLockContract;

    address public owner = address(this);
    address public feeReceiver = makeAddr("feeReceiver");
    address public creator = makeAddr("creator");
    address public trader = makeAddr("trader");
    address public unauthorized = makeAddr("unauthorized");

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

        router = new FRouter();
        router.initialize(address(factory));

        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (owner));
        lpLockContract = LPLock(address(new ERC1967Proxy(address(lpLockImpl), lpLockInit)));

        Bonding bondingImpl = new Bonding();
        bytes memory initData = abi.encodeCall(
            Bonding.initialize,
            (address(factory), address(router), feeReceiver, MAX_TX, address(hyperswapRouter), address(lpLockContract))
        );
        bonding = Bonding(address(new ERC1967Proxy(address(bondingImpl), initData)));

        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), address(bonding));
        router.grantRole(router.BONDING_ROLE(), address(bonding));
        lpLockContract.setLocker(address(bonding), true);
        bonding.setRedemptionRouter(creator);
        factory.setFeeParams(address(bonding), BUY_TAX_BPS, SELL_TAX_BPS);
    }

    function _launchToken() internal returns (address tokenAddr) {
        lt.mintDirect(creator, 200 ether);
        vm.startPrank(creator);
        lt.approve(address(router), 200 ether);
        lt.approve(address(bonding), 200 ether);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "UpgradeTest",
            ticker: "UPG",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            purchaseAmount: 200 ether
        });
        (tokenAddr,,) = bonding.launch(params, creator);
        vm.stopPrank();
    }

    // ─── Bonding Upgrade ─────────────────────────────────────────────────

    function test_bonding_ownerCanUpgrade() public {
        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        assertEq(BondingV2(address(bonding)).version(), 2);
    }

    function test_bonding_nonOwnerCannotUpgrade() public {
        BondingV2 newImpl = new BondingV2();

        vm.prank(unauthorized);
        vm.expectRevert();
        bonding.upgradeToAndCall(address(newImpl), "");
    }

    function test_bonding_preservesOwner() public {
        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        assertEq(bonding.owner(), owner);
    }

    function test_bonding_preservesFactoryRouter() public {
        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        assertEq(address(bonding.factory()), address(factory));
        assertEq(address(bonding.router()), address(router));
    }

    function test_bonding_preservesTokensAfterUpgrade() public {
        address tokenAddr = _launchToken();

        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        (address infoCreator,,,,,, bool trading,) = bonding.tokenInfo(tokenAddr);
        assertEq(infoCreator, creator);
        assertTrue(trading);
        assertEq(bonding.allTokensLength(), 1);
    }

    function test_bonding_preservesFeesAfterUpgrade() public {
        address tokenAddr = _launchToken();

        lt.mintDirect(trader, 1000 ether);
        vm.startPrank(trader);
        lt.approve(address(router), 1000 ether);
        bonding.buy(1000 ether, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        uint256 creatorFeesBefore = bonding.creatorFees(creator, address(lt));
        uint256 protocolFeesBefore = bonding.protocolFees(address(lt));

        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        assertEq(bonding.creatorFees(creator, address(lt)), creatorFeesBefore);
        assertEq(bonding.protocolFees(address(lt)), protocolFeesBefore);
    }

    function test_bonding_canTradeAfterUpgrade() public {
        address tokenAddr = _launchToken();

        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        lt.mintDirect(trader, 500 ether);
        vm.startPrank(trader);
        lt.approve(address(router), 500 ether);
        uint256 tokensOut = bonding.buy(500 ether, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(tokensOut > 0, "Should be able to trade after upgrade");
    }

    function test_bonding_v2FunctionsWork() public {
        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        BondingV2(address(bonding)).setNewSlot(42);
        assertEq(BondingV2(address(bonding)).newSlot(), 42);
    }

    function test_bonding_implementationCannotBeInitialized() public {
        Bonding impl = new Bonding();
        vm.expectRevert();
        impl.initialize(address(1), address(2), address(3), 100, address(4), address(5));
    }
}
