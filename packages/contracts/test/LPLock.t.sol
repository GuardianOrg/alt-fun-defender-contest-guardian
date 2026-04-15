// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {LPLock} from "../src/LPLock.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract LPLockV2 is LPLock {
    uint256 public newStorageSlot;

    function version() external pure returns (uint256) {
        return 2;
    }
}

contract LPLockTest is Test {
    LPLock public lpLock;
    MockERC20 public lpToken;

    address public owner = address(this);
    address public bonding = makeAddr("bonding");
    address public unauthorized = makeAddr("unauthorized");
    address public tokenAddr = makeAddr("token");
    address public pairAddr = makeAddr("pair");

    function setUp() public {
        LPLock impl = new LPLock();
        bytes memory initData = abi.encodeCall(LPLock.initialize, (owner));
        lpLock = LPLock(address(new ERC1967Proxy(address(impl), initData)));

        lpToken = new MockERC20("LP Token", "LP");

        lpLock.setLocker(bonding, true);
    }

    // ─── Initialization ──────────────────────────────────────────────────

    function test_initialize_setsOwner() public view {
        assertEq(lpLock.owner(), owner);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        lpLock.initialize(unauthorized);
    }

    // ─── setLocker ───────────────────────────────────────────────────────

    function test_setLocker_grantsLockerRole() public view {
        assertTrue(lpLock.isLocker(bonding));
    }

    function test_setLocker_revokesLockerRole() public {
        lpLock.setLocker(bonding, false);
        assertFalse(lpLock.isLocker(bonding));
    }

    function test_setLocker_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LPLock.LockerUpdated(unauthorized, true);
        lpLock.setLocker(unauthorized, true);
    }

    function test_setLocker_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        lpLock.setLocker(unauthorized, true);
    }

    // ─── recordLock ──────────────────────────────────────────────────────

    function test_recordLock_storesLockInfo() public {
        uint256 amount = 1000 ether;

        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, amount);

        (address lp, uint256 locked, uint256 lockedAt) = lpLock.getLock(tokenAddr);
        assertEq(lp, pairAddr);
        assertEq(locked, amount);
        assertEq(lockedAt, block.timestamp);
    }

    function test_recordLock_emitsEvent() public {
        uint256 amount = 500 ether;

        vm.expectEmit(true, true, false, true);
        emit LPLock.LPLocked(tokenAddr, pairAddr, amount);

        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, amount);
    }

    function test_recordLock_revertsForNonLocker() public {
        vm.prank(unauthorized);
        vm.expectRevert(LPLock.NotAuthorized.selector);
        lpLock.recordLock(tokenAddr, pairAddr, 100 ether);
    }

    function test_recordLock_overwritesPreviousLock() public {
        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, 100 ether);

        address newPair = makeAddr("newPair");
        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, newPair, 200 ether);

        (address lp, uint256 locked,) = lpLock.getLock(tokenAddr);
        assertEq(lp, newPair);
        assertEq(locked, 200 ether);
    }

    // ─── getLock ──────────────────────────────────────────────────────────

    function test_getLock_returnsZeroForUnlockedToken() public {
        address unknown = makeAddr("unknown");
        (address lp, uint256 amount, uint256 lockedAt) = lpLock.getLock(unknown);
        assertEq(lp, address(0));
        assertEq(amount, 0);
        assertEq(lockedAt, 0);
    }

    // ─── UUPS Upgrade ────────────────────────────────────────────────────

    function test_upgrade_ownerCanUpgrade() public {
        LPLockV2 newImpl = new LPLockV2();
        lpLock.upgradeToAndCall(address(newImpl), "");

        assertEq(LPLockV2(address(lpLock)).version(), 2);
    }

    function test_upgrade_nonOwnerCannotUpgrade() public {
        LPLockV2 newImpl = new LPLockV2();

        vm.prank(unauthorized);
        vm.expectRevert();
        lpLock.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_preservesState() public {
        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, 777 ether);

        LPLockV2 newImpl = new LPLockV2();
        lpLock.upgradeToAndCall(address(newImpl), "");

        (address lp, uint256 locked,) = lpLock.getLock(tokenAddr);
        assertEq(lp, pairAddr);
        assertEq(locked, 777 ether);
        assertTrue(lpLock.isLocker(bonding));
        assertEq(lpLock.owner(), owner);
    }

    // ─── Fuzz ────────────────────────────────────────────────────────────

    function testFuzz_recordLock_arbitraryAmounts(
        uint256 amount
    ) public {
        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, amount);

        (, uint256 locked,) = lpLock.getLock(tokenAddr);
        assertEq(locked, amount);
    }
}
