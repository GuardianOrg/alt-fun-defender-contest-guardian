// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bonding} from "../src/Bonding.sol";
import {Zap} from "../src/Zap.sol";
import {LPLock} from "../src/LPLock.sol";
import {DeployHelper} from "./DeployHelper.sol";

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

contract UUPSUpgradeTest is DeployHelper {
    address public unauthorized = makeAddr("unauthorized");

    function setUp() public {
        _deployCore();
        bonding.addRouter(creator);
        bonding.addRouter(trader);
    }

    function _launchToken() internal returns (address tokenAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "UpgradeTest",
            ticker: "UPG",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });
        vm.prank(creator);
        (tokenAddr,,) = bonding.launch(params, creator);

        // Seed buy now happens via the standard buy path (no longer inside
        // `Bonding.launch`). Drive it directly through `bonding.buy` since
        // these tests bypass the Zap.
        lt.mintDirect(creator, 200 ether);
        vm.startPrank(creator);
        lt.approve(address(curveRouter), 200 ether);
        bonding.buy(200 ether, tokenAddr, 0, creator);
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
        assertEq(address(bonding.router()), address(curveRouter));
    }

    function test_bonding_preservesTokensAfterUpgrade() public {
        address tokenAddr = _launchToken();

        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        (address infoCreator,,,,, Bonding.Lifecycle lifecycle) = bonding.tokenInfo(tokenAddr);
        assertEq(infoCreator, creator);
        assertTrue(lifecycle == Bonding.Lifecycle.Curve);
        assertEq(bonding.allTokensLength(), 1);
    }

    function test_bonding_preservesTokenListAfterUpgrade() public {
        address tokenAddr = _launchToken();

        lt.mintDirect(trader, 1000 ether);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), 1000 ether);
        bonding.buy(1000 ether, tokenAddr, 0, trader);
        vm.stopPrank();

        uint256 tokensBefore = bonding.allTokensLength();

        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        assertEq(bonding.allTokensLength(), tokensBefore);
    }

    function test_bonding_canTradeAfterUpgrade() public {
        address tokenAddr = _launchToken();

        BondingV2 newImpl = new BondingV2();
        bonding.upgradeToAndCall(address(newImpl), "");

        lt.mintDirect(trader, 500 ether);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), 500 ether);
        (uint256 tokensOut,) = bonding.buy(500 ether, tokenAddr, 0, trader);
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
        impl.initialize(address(1), address(2), address(3), address(4), address(5));
    }

    function test_zap_implementationCannotBeInitialized() public {
        Zap impl = new Zap();
        vm.expectRevert();
        impl.initialize(address(1), address(2), address(3), address(4), 0, 0, 0);
    }

    function test_lpLock_implementationCannotBeInitialized() public {
        LPLock impl = new LPLock();
        vm.expectRevert();
        impl.initialize(address(1));
    }
}
