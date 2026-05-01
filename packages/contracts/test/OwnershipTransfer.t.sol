// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Bonding} from "../src/Bonding.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {LPLock} from "../src/LPLock.sol";
import {Zap} from "../src/Zap.sol";
import {DeployHelper} from "./DeployHelper.sol";

/// @notice Verifies that every multisig-owned proxy uses OZ's two-step
///         ownership transfer (issue #323). A single-step transfer to a
///         fat-fingered or contract-incompatible address would brick every
///         owner-only path on the live proxy with no recovery — the pending-
///         owner gate is the only practical defence against that footgun.
///
///         Tests are parameterised over `Ownable2StepUpgradeable` because all
///         four contracts (`Bonding`, `Zap`, `LPLock`, `FeeVault`) inherit
///         the same OZ extension; the per-contract wrappers are just
///         deployment shims so each proxy gets exercised end-to-end.
contract OwnershipTransferTest is DeployHelper {
    Zap public zap;

    address public newOwner = makeAddr("newOwner");
    address public attacker = makeAddr("attacker");

    function setUp() public {
        _deployCore();

        // `_deployCore` doesn't wire up a Zap (suite-specific); deploy one
        // here so this file covers all four multisig-owned contracts.
        Zap zapImpl = new Zap();
        bytes memory zapInit = abi.encodeCall(
            Zap.initialize, (address(bonding), address(usdc), address(hyperswapRouter), address(feeVault), 50, 50, 2000)
        );
        zap = Zap(address(new ERC1967Proxy(address(zapImpl), zapInit)));
    }

    // ─── Shared assertions ───────────────────────────────────────────────

    function _assertTransferDoesNotChangeOwnerImmediately(
        Ownable2StepUpgradeable target
    ) internal {
        address before = target.owner();
        target.transferOwnership(newOwner);

        assertEq(target.owner(), before, "owner must not change until accept");
        assertEq(target.pendingOwner(), newOwner, "pendingOwner must be set");
    }

    function _assertAcceptCompletesTransfer(
        Ownable2StepUpgradeable target
    ) internal {
        target.transferOwnership(newOwner);
        vm.prank(newOwner);
        target.acceptOwnership();

        assertEq(target.owner(), newOwner, "owner must update on accept");
        assertEq(target.pendingOwner(), address(0), "pendingOwner must be cleared");
    }

    function _assertOnlyPendingOwnerCanAccept(
        Ownable2StepUpgradeable target
    ) internal {
        target.transferOwnership(newOwner);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, attacker));
        target.acceptOwnership();
    }

    function _assertOnlyOwnerCanInitiate(
        Ownable2StepUpgradeable target
    ) internal {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, attacker));
        target.transferOwnership(newOwner);
    }

    function _assertCanCancelPendingTransfer(
        Ownable2StepUpgradeable target
    ) internal {
        target.transferOwnership(newOwner);
        // OZ's two-step explicitly allows `address(0)` as a cancellation
        // signal — single-step `Ownable.transferOwnership(0)` would have
        // renounced; here it just clears the pending slot.
        target.transferOwnership(address(0));
        assertEq(target.pendingOwner(), address(0), "cancellation must clear pendingOwner");

        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, newOwner));
        target.acceptOwnership();
    }

    function _assertCanReplacePendingTransfer(
        Ownable2StepUpgradeable target
    ) internal {
        address replacement = makeAddr("replacement");

        target.transferOwnership(newOwner);
        target.transferOwnership(replacement);

        assertEq(target.pendingOwner(), replacement, "second proposal must replace first");

        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, newOwner));
        target.acceptOwnership();

        vm.prank(replacement);
        target.acceptOwnership();
        assertEq(target.owner(), replacement);
    }

    // ─── Bonding ─────────────────────────────────────────────────────────

    function test_bonding_doesNotChangeOwnerImmediately() public {
        _assertTransferDoesNotChangeOwnerImmediately(Ownable2StepUpgradeable(address(bonding)));
    }

    function test_bonding_acceptCompletesTransfer() public {
        _assertAcceptCompletesTransfer(Ownable2StepUpgradeable(address(bonding)));
    }

    function test_bonding_onlyPendingOwnerCanAccept() public {
        _assertOnlyPendingOwnerCanAccept(Ownable2StepUpgradeable(address(bonding)));
    }

    function test_bonding_onlyOwnerCanInitiate() public {
        _assertOnlyOwnerCanInitiate(Ownable2StepUpgradeable(address(bonding)));
    }

    function test_bonding_canCancelPendingTransfer() public {
        _assertCanCancelPendingTransfer(Ownable2StepUpgradeable(address(bonding)));
    }

    function test_bonding_canReplacePendingTransfer() public {
        _assertCanReplacePendingTransfer(Ownable2StepUpgradeable(address(bonding)));
    }

    function test_bonding_postTransferOwnerActsAsOwner() public {
        bonding.transferOwnership(newOwner);
        vm.prank(newOwner);
        bonding.acceptOwnership();

        // Old owner can no longer call onlyOwner paths.
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        bonding.addRouter(makeAddr("someRouter"));

        // New owner can. Use a fresh address so the AddressSet add doesn't
        // collide with anything wired in `_deployCore`.
        address freshRouter = makeAddr("freshRouter");
        vm.prank(newOwner);
        bonding.addRouter(freshRouter);
        assertTrue(bonding.isRouter(freshRouter));
    }

    // ─── Zap ─────────────────────────────────────────────────────────────

    function test_zap_doesNotChangeOwnerImmediately() public {
        _assertTransferDoesNotChangeOwnerImmediately(Ownable2StepUpgradeable(address(zap)));
    }

    function test_zap_acceptCompletesTransfer() public {
        _assertAcceptCompletesTransfer(Ownable2StepUpgradeable(address(zap)));
    }

    function test_zap_onlyPendingOwnerCanAccept() public {
        _assertOnlyPendingOwnerCanAccept(Ownable2StepUpgradeable(address(zap)));
    }

    function test_zap_onlyOwnerCanInitiate() public {
        _assertOnlyOwnerCanInitiate(Ownable2StepUpgradeable(address(zap)));
    }

    function test_zap_canCancelPendingTransfer() public {
        _assertCanCancelPendingTransfer(Ownable2StepUpgradeable(address(zap)));
    }

    function test_zap_canReplacePendingTransfer() public {
        _assertCanReplacePendingTransfer(Ownable2StepUpgradeable(address(zap)));
    }

    function test_zap_postTransferOwnerActsAsOwner() public {
        zap.transferOwnership(newOwner);
        vm.prank(newOwner);
        zap.acceptOwnership();

        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        zap.setFees(10, 10, 1000);

        vm.prank(newOwner);
        zap.setFees(10, 10, 1000);
        assertEq(zap.buyFeeBps(), 10);
        assertEq(zap.sellFeeBps(), 10);
        assertEq(zap.creatorFeeBps(), 1000);
    }

    // ─── LPLock ──────────────────────────────────────────────────────────

    function test_lpLock_doesNotChangeOwnerImmediately() public {
        _assertTransferDoesNotChangeOwnerImmediately(Ownable2StepUpgradeable(address(lpLockContract)));
    }

    function test_lpLock_acceptCompletesTransfer() public {
        _assertAcceptCompletesTransfer(Ownable2StepUpgradeable(address(lpLockContract)));
    }

    function test_lpLock_onlyPendingOwnerCanAccept() public {
        _assertOnlyPendingOwnerCanAccept(Ownable2StepUpgradeable(address(lpLockContract)));
    }

    function test_lpLock_onlyOwnerCanInitiate() public {
        _assertOnlyOwnerCanInitiate(Ownable2StepUpgradeable(address(lpLockContract)));
    }

    function test_lpLock_canCancelPendingTransfer() public {
        _assertCanCancelPendingTransfer(Ownable2StepUpgradeable(address(lpLockContract)));
    }

    function test_lpLock_canReplacePendingTransfer() public {
        _assertCanReplacePendingTransfer(Ownable2StepUpgradeable(address(lpLockContract)));
    }

    function test_lpLock_postTransferOwnerActsAsOwner() public {
        lpLockContract.transferOwnership(newOwner);
        vm.prank(newOwner);
        lpLockContract.acceptOwnership();

        address freshLocker = makeAddr("freshLocker");
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        lpLockContract.addLocker(freshLocker);

        vm.prank(newOwner);
        lpLockContract.addLocker(freshLocker);
        assertTrue(lpLockContract.isLocker(freshLocker));
    }

    // ─── FeeVault ────────────────────────────────────────────────────────

    function test_feeVault_doesNotChangeOwnerImmediately() public {
        _assertTransferDoesNotChangeOwnerImmediately(Ownable2StepUpgradeable(address(feeVault)));
    }

    function test_feeVault_acceptCompletesTransfer() public {
        _assertAcceptCompletesTransfer(Ownable2StepUpgradeable(address(feeVault)));
    }

    function test_feeVault_onlyPendingOwnerCanAccept() public {
        _assertOnlyPendingOwnerCanAccept(Ownable2StepUpgradeable(address(feeVault)));
    }

    function test_feeVault_onlyOwnerCanInitiate() public {
        _assertOnlyOwnerCanInitiate(Ownable2StepUpgradeable(address(feeVault)));
    }

    function test_feeVault_canCancelPendingTransfer() public {
        _assertCanCancelPendingTransfer(Ownable2StepUpgradeable(address(feeVault)));
    }

    function test_feeVault_canReplacePendingTransfer() public {
        _assertCanReplacePendingTransfer(Ownable2StepUpgradeable(address(feeVault)));
    }

    function test_feeVault_postTransferOwnerActsAsOwner() public {
        feeVault.transferOwnership(newOwner);
        vm.prank(newOwner);
        feeVault.acceptOwnership();

        address freshDepositor = makeAddr("freshDepositor");
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        feeVault.addDepositor(freshDepositor);

        vm.prank(newOwner);
        feeVault.addDepositor(freshDepositor);
        assertTrue(feeVault.isDepositor(freshDepositor));
    }
}
