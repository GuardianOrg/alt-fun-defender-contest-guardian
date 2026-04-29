// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev ERC20 that triggers a reentrancy attempt on every transfer. Used to
///      confirm `FeeVault.claim` is protected by `ReentrancyGuard`.
contract ReentrantUsdc is MockERC20 {
    FeeVault public vault;
    bool private _attacking;

    constructor() MockERC20("USD Coin", "USDC") {}

    function setVault(
        FeeVault vault_
    ) external {
        vault = vault_;
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        super._update(from, to, value);
        if (_attacking || address(vault) == address(0)) return;
        if (from == address(vault)) {
            _attacking = true;
            // Re-enter claim — should revert with ReentrancyGuardReentrantCall.
            try vault.claim() {} catch {}
            _attacking = false;
        }
    }
}

contract FeeVaultTest is Test {
    FeeVault public vault;
    MockERC20 public usdc;

    address public owner = address(this);
    address public feeTo = makeAddr("feeTo");
    address public depositor = makeAddr("depositor");
    address public creator = makeAddr("creator");
    address public stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(usdc), feeTo));
        vault = FeeVault(address(new ERC1967Proxy(address(impl), init)));
    }

    // ─── Initialization ──────────────────────────────────────────────────

    function test_initialize_setsState() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.feeTo(), feeTo);
        assertEq(vault.owner(), owner);
    }

    function test_initialize_revertsOnZeroUsdc() public {
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(0), feeTo));
        vm.expectRevert(FeeVault.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), init);
    }

    function test_initialize_revertsOnZeroFeeTo() public {
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(usdc), address(0)));
        vm.expectRevert(FeeVault.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), init);
    }

    // ─── Depositor Allowlist ─────────────────────────────────────────────

    function test_addDepositor_updatesSet() public {
        vault.addDepositor(depositor);
        assertTrue(vault.isDepositor(depositor));
        address[] memory all = vault.getDepositors();
        assertEq(all.length, 1);
        assertEq(all[0], depositor);
    }

    function test_addDepositor_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit FeeVault.DepositorAdded(depositor);
        vault.addDepositor(depositor);
    }

    function test_addDepositor_revertsOnZero() public {
        vm.expectRevert(FeeVault.ZeroAddress.selector);
        vault.addDepositor(address(0));
    }

    function test_addDepositor_revertsOnDuplicate() public {
        vault.addDepositor(depositor);
        vm.expectRevert(FeeVault.DepositorAlreadyAdded.selector);
        vault.addDepositor(depositor);
    }

    function test_addDepositor_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.addDepositor(depositor);
    }

    function test_removeDepositor_worksAndEmits() public {
        vault.addDepositor(depositor);
        vm.expectEmit(true, false, false, false);
        emit FeeVault.DepositorRemoved(depositor);
        vault.removeDepositor(depositor);
        assertFalse(vault.isDepositor(depositor));
    }

    function test_removeDepositor_revertsIfMissing() public {
        vm.expectRevert(FeeVault.DepositorNotFound.selector);
        vault.removeDepositor(depositor);
    }

    // ─── Accrual ─────────────────────────────────────────────────────────

    function test_accrue_revertsForNonDepositor() public {
        usdc.mint(address(vault), 100 ether);
        vm.prank(stranger);
        vm.expectRevert(FeeVault.NotDepositor.selector);
        vault.accrue(address(0xdead), creator, 20 ether, 80 ether, true);
    }

    function test_accrue_updatesBalancesAndLifetime() public {
        vault.addDepositor(depositor);
        usdc.mint(address(vault), 100 ether);

        vm.expectEmit(true, true, false, true);
        emit FeeVault.FeeAccrued(address(0xbeef), creator, 20 ether, 80 ether, true);
        vm.prank(depositor);
        vault.accrue(address(0xbeef), creator, 20 ether, 80 ether, true);

        assertEq(vault.creatorBalance(creator), 20 ether);
        assertEq(vault.protocolBalance(), 80 ether);
        assertEq(vault.lifetimeCreatorEarned(creator), 20 ether);
        assertEq(vault.lifetimeProtocolEarned(), 80 ether);
    }

    function test_accrue_accumulatesAcrossDepositors() public {
        address d2 = makeAddr("depositor2");
        vault.addDepositor(depositor);
        vault.addDepositor(d2);
        usdc.mint(address(vault), 300 ether);

        vm.prank(depositor);
        vault.accrue(address(0xbeef), creator, 5 ether, 15 ether, true);
        vm.prank(d2);
        vault.accrue(address(0xbeef), creator, 10 ether, 40 ether, false);

        assertEq(vault.creatorBalance(creator), 15 ether);
        assertEq(vault.protocolBalance(), 55 ether);
    }

    function test_accrue_revertsIfDepositorDidNotPreFund() public {
        // A buggy depositor that calls `accrue` without first transferring USDC
        // must be caught before any user funds are corrupted.
        vault.addDepositor(depositor);

        vm.prank(depositor);
        vm.expectRevert(FeeVault.UnderfundedAccrual.selector);
        vault.accrue(address(0xbeef), creator, 20 ether, 80 ether, true);
    }

    function test_accrue_revertsIfDepositorPartiallyFunded() public {
        // Even partial under-funding (less than the accrued total) must revert,
        // otherwise the vault's running tallies drift away from its real balance.
        vault.addDepositor(depositor);
        usdc.mint(address(vault), 99 ether);

        vm.prank(depositor);
        vm.expectRevert(FeeVault.UnderfundedAccrual.selector);
        vault.accrue(address(0xbeef), creator, 20 ether, 80 ether, true);
    }

    function test_accrue_revertsIfSecondAccrualDrainsHeadroom() public {
        // The first accrual is funded; a second accrual without further USDC
        // transfer should revert because the running tally now exceeds balance.
        vault.addDepositor(depositor);
        usdc.mint(address(vault), 100 ether);

        vm.prank(depositor);
        vault.accrue(address(0xbeef), creator, 20 ether, 80 ether, true);

        // Vault is now exactly funded for the first claim. A follow-on accrual
        // without a fresh transfer must fail.
        vm.prank(depositor);
        vm.expectRevert(FeeVault.UnderfundedAccrual.selector);
        vault.accrue(address(0xbeef), creator, 1, 0, true);
    }

    function test_accrue_tracksTotalAccruedCreator() public {
        address creator2 = makeAddr("creator2");
        vault.addDepositor(depositor);
        usdc.mint(address(vault), 200 ether);

        vm.prank(depositor);
        vault.accrue(address(0xbeef), creator, 20 ether, 30 ether, true);
        assertEq(vault.totalAccruedCreator(), 20 ether);

        vm.prank(depositor);
        vault.accrue(address(0xbeef), creator2, 50 ether, 10 ether, false);
        assertEq(vault.totalAccruedCreator(), 70 ether);
    }

    // ─── Creator Claim ───────────────────────────────────────────────────

    function test_claim_paysOutAndResetsBalance() public {
        vault.addDepositor(depositor);
        usdc.mint(address(vault), 100 ether);
        vm.prank(depositor);
        vault.accrue(address(0xbeef), creator, 20 ether, 80 ether, true);

        vm.expectEmit(true, false, false, true);
        emit FeeVault.CreatorFeesClaimed(creator, 20 ether);
        vm.prank(creator);
        uint256 claimed = vault.claim();

        assertEq(claimed, 20 ether);
        assertEq(usdc.balanceOf(creator), 20 ether);
        assertEq(vault.creatorBalance(creator), 0);
        // Lifetime is never reset.
        assertEq(vault.lifetimeCreatorEarned(creator), 20 ether);
        // Running counter decremented so it stays in sync with the claim mapping.
        assertEq(vault.totalAccruedCreator(), 0);
    }

    function test_claim_revertsWhenEmpty() public {
        vm.prank(creator);
        vm.expectRevert(FeeVault.NothingToClaim.selector);
        vault.claim();
    }

    // ─── Protocol Claim ──────────────────────────────────────────────────

    function test_claimProtocol_paysOutAndResets() public {
        vault.addDepositor(depositor);
        usdc.mint(address(vault), 100 ether);
        vm.prank(depositor);
        vault.accrue(address(0xbeef), creator, 20 ether, 80 ether, false);

        vm.expectEmit(true, false, false, true);
        emit FeeVault.ProtocolFeesClaimed(feeTo, 80 ether);
        uint256 claimed = vault.claimProtocol();

        assertEq(claimed, 80 ether);
        assertEq(usdc.balanceOf(feeTo), 80 ether);
        assertEq(vault.protocolBalance(), 0);
    }

    function test_claimProtocol_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.claimProtocol();
    }

    function test_claimProtocol_revertsWhenEmpty() public {
        vm.expectRevert(FeeVault.NothingToClaim.selector);
        vault.claimProtocol();
    }

    // ─── Admin: setFeeTo ─────────────────────────────────────────────────

    function test_setFeeTo_updatesValue() public {
        address newFeeTo = makeAddr("newFeeTo");
        vm.expectEmit(true, false, false, false);
        emit FeeVault.FeeToUpdated(newFeeTo);
        vault.setFeeTo(newFeeTo);
        assertEq(vault.feeTo(), newFeeTo);
    }

    function test_setFeeTo_revertsOnZero() public {
        vm.expectRevert(FeeVault.ZeroAddress.selector);
        vault.setFeeTo(address(0));
    }

    function test_setFeeTo_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setFeeTo(makeAddr("x"));
    }

    // ─── Reentrancy ──────────────────────────────────────────────────────

    function test_claim_reentrancyBlocked() public {
        // Redeploy with a malicious USDC that attempts to re-enter `claim()`
        // from inside the outbound transfer.
        ReentrantUsdc hostileUsdc = new ReentrantUsdc();
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(hostileUsdc), feeTo));
        FeeVault hostileVault = FeeVault(address(new ERC1967Proxy(address(impl), init)));
        hostileUsdc.setVault(hostileVault);

        hostileVault.addDepositor(depositor);
        hostileUsdc.mint(address(hostileVault), 100 ether);
        vm.prank(depositor);
        hostileVault.accrue(address(0xbeef), creator, 20 ether, 80 ether, true);

        // Claim succeeds at the outer level; the inner re-entry is caught and
        // swallowed by the hostile USDC. Balance still fully zeroes out.
        vm.prank(creator);
        uint256 claimed = hostileVault.claim();
        assertEq(claimed, 20 ether);
        assertEq(hostileVault.creatorBalance(creator), 0);
        assertEq(hostileUsdc.balanceOf(creator), 20 ether);
    }
}
