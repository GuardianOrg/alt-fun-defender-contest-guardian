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
    address public pairAddr;

    function setUp() public {
        LPLock impl = new LPLock();
        bytes memory initData = abi.encodeCall(LPLock.initialize, (owner));
        lpLock = LPLock(address(new ERC1967Proxy(address(impl), initData)));

        lpToken = new MockERC20("LP Token", "LP");
        pairAddr = address(lpToken);

        lpLock.addLocker(bonding);
    }

    // ─── Initialization ──────────────────────────────────────────────────

    function test_initialize_setsOwner() public view {
        assertEq(lpLock.owner(), owner);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        lpLock.initialize(unauthorized);
    }

    // ─── addLocker ───────────────────────────────────────────────────────
    //
    // `addLocker` is add-only by design — there is no `removeLocker`. A live
    // revoke would brick every in-flight `Bonding.finalizeGraduation`
    // (issue #311 Variant 1). Migrating to a different locker requires a
    // UUPS upgrade.

    function test_addLocker_grantsLockerRole() public view {
        assertTrue(lpLock.isLocker(bonding));
    }

    function test_addLocker_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LPLock.LockerAdded(unauthorized);
        lpLock.addLocker(unauthorized);
    }

    function test_addLocker_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        lpLock.addLocker(unauthorized);
    }

    function test_addLocker_revertsOnZeroAddress() public {
        vm.expectRevert(LPLock.ZeroAddress.selector);
        lpLock.addLocker(address(0));
    }

    function test_addLocker_revertsWhenAlreadyAdded() public {
        vm.expectRevert(LPLock.LockerAlreadyAdded.selector);
        lpLock.addLocker(bonding);
    }

    function test_setLocker_hasNoLiveSetter() public {
        // Owner `call` (not `staticcall`) with non-zero args: a missing
        // selector hits the empty fallback and returns no revert data, while
        // a reintroduced setter would revert with a typed error or a 4-byte
        // selector and trip the `revertData.length` assertion.
        bytes4 setLockerSelector = bytes4(keccak256("setLocker(address,bool)"));
        (bool ok, bytes memory revertData) =
            address(lpLock).call(abi.encodeWithSelector(setLockerSelector, bonding, false));
        assertFalse(ok, "setLocker must not exist on LPLock");
        assertEq(revertData.length, 0, "setLocker reverted with data -- selector still routes");
    }

    // ─── recordLock ──────────────────────────────────────────────────────

    function test_recordLock_storesLockInfo() public {
        uint256 amount = 1000 ether;
        lpToken.mint(address(lpLock), amount);

        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, amount);

        (address lp, uint256 locked, uint256 lockedAt) = lpLock.getLock(tokenAddr);
        assertEq(lp, pairAddr);
        assertEq(locked, amount);
        assertEq(lockedAt, block.timestamp);
    }

    function test_recordLock_emitsEvent() public {
        uint256 amount = 500 ether;
        lpToken.mint(address(lpLock), amount);

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

    function test_recordLock_revertsWhenBalanceInsufficient() public {
        lpToken.mint(address(lpLock), 99 ether);

        vm.prank(bonding);
        vm.expectRevert(LPLock.InsufficientLPBalance.selector);
        lpLock.recordLock(tokenAddr, pairAddr, 100 ether);
    }

    function test_recordLock_revertsWhenAlreadyLocked() public {
        lpToken.mint(address(lpLock), 300 ether);

        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, 100 ether);

        vm.prank(bonding);
        vm.expectRevert(LPLock.AlreadyLocked.selector);
        lpLock.recordLock(tokenAddr, pairAddr, 200 ether);
    }

    function test_recordLock_revertsOnZeroAmount() public {
        vm.prank(bonding);
        vm.expectRevert(LPLock.ZeroAmount.selector);
        lpLock.recordLock(tokenAddr, pairAddr, 0);
    }

    function test_recordLock_revertsOnZeroPair() public {
        vm.prank(bonding);
        vm.expectRevert(LPLock.ZeroAddress.selector);
        lpLock.recordLock(tokenAddr, address(0), 100 ether);
    }

    // A zero-amount call can never seed a re-writable slot: it reverts before
    // touching storage, so a later call for the same token still hits the
    // `AlreadyLocked` guard once a real lock exists.
    function test_recordLock_zeroAmountCannotBypassOneShotGuard() public {
        vm.prank(bonding);
        vm.expectRevert(LPLock.ZeroAmount.selector);
        lpLock.recordLock(tokenAddr, pairAddr, 0);

        (address lp, uint256 amount, uint256 lockedAt) = lpLock.getLock(tokenAddr);
        assertEq(lp, address(0));
        assertEq(amount, 0);
        assertEq(lockedAt, 0);

        lpToken.mint(address(lpLock), 300 ether);
        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, 100 ether);

        vm.prank(bonding);
        vm.expectRevert(LPLock.AlreadyLocked.selector);
        lpLock.recordLock(tokenAddr, pairAddr, 200 ether);
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
        lpToken.mint(address(lpLock), 777 ether);
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
        amount = bound(amount, 1, type(uint256).max);
        lpToken.mint(address(lpLock), amount);

        vm.prank(bonding);
        lpLock.recordLock(tokenAddr, pairAddr, amount);

        (, uint256 locked,) = lpLock.getLock(tokenAddr);
        assertEq(locked, amount);
    }
}
