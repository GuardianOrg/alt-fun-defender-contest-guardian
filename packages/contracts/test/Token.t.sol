// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Token} from "../src/Token.sol";

/// @notice Direct unit tests for `Token._update` maxTx enforcement.
/// @dev `Bonding.t.sol` only verifies that `bonding.maxTx()` returns the
///      configured value — it never exercises the actual transfer-blocking
///      behaviour that lives in `Token._update`. These tests cover that path
///      so a regression in the override is caught by CI.
///
///      The implementation contract calls `_disableInitializers()` in its
///      constructor, so we deploy via `Clones.clone` (mirroring `Bonding.launch`)
///      and initialise the clone directly.
contract TokenTest is Test {
    Token public impl;
    Token public token;

    address public owner = address(this);
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint256 constant TOTAL_SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        impl = new Token();
    }

    function _deployToken(
        uint256 maxTxPercent_
    ) internal returns (Token) {
        Token clone = Token(Clones.clone(address(impl)));
        clone.initialize("Test", "TST", maxTxPercent_, owner);
        return clone;
    }

    // ─── Initialization ──────────────────────────────────────────────────

    function test_initialize_setsMaxTxPercent() public {
        token = _deployToken(1);
        assertEq(token.maxTxPercent(), 1);
        assertEq(token.maxTxAmount(), TOTAL_SUPPLY / 100);
    }

    function test_initialize_excludesOwner() public {
        token = _deployToken(1);
        assertTrue(token.isExcludedFromMaxTx(owner));
    }

    function test_initialize_excludesContract() public {
        token = _deployToken(1);
        assertTrue(token.isExcludedFromMaxTx(address(token)));
    }

    // ─── maxTx Enforcement ───────────────────────────────────────────────

    function test_transfer_revertsWhenExceedsMaxTx() public {
        // maxTxPercent = 1 → maxTxAmount = 10M.
        token = _deployToken(1);
        // Owner is excluded, so seeding alice with > maxTx is allowed.
        token.transfer(alice, 50_000_000 ether);

        // Alice is *not* excluded, so a transfer above maxTx must revert.
        vm.prank(alice);
        vm.expectRevert(Token.ExceedsMaxTx.selector);
        token.transfer(bob, 10_000_001 ether);
    }

    function test_transfer_succeedsAtExactMaxTx() public {
        // The check is strictly `>`, so an amount equal to `maxTxAmount`
        // must pass.
        token = _deployToken(1);
        token.transfer(alice, 50_000_000 ether);

        vm.prank(alice);
        token.transfer(bob, 10_000_000 ether);
        assertEq(token.balanceOf(bob), 10_000_000 ether);
    }

    function test_transfer_succeedsWhenWithinMaxTx() public {
        token = _deployToken(1);
        token.transfer(alice, 50_000_000 ether);

        vm.prank(alice);
        token.transfer(bob, 5_000_000 ether);
        assertEq(token.balanceOf(bob), 5_000_000 ether);
    }

    function test_transfer_excludedSenderBypassesMaxTx() public {
        // Owner is excluded by `initialize`, so a 100M transfer (10× maxTx)
        // succeeds despite the limit.
        token = _deployToken(1);
        token.transfer(alice, 100_000_000 ether);
        assertEq(token.balanceOf(alice), 100_000_000 ether);
    }

    function test_setMaxTxExclusion_allowsOversizedTransfer() public {
        token = _deployToken(1);
        token.transfer(alice, 50_000_000 ether);

        // Without exclusion, alice's 20M transfer would revert.
        token.setMaxTxExclusion(alice, true);
        assertTrue(token.isExcludedFromMaxTx(alice));

        vm.prank(alice);
        token.transfer(bob, 20_000_000 ether);
        assertEq(token.balanceOf(bob), 20_000_000 ether);
    }

    function test_setMaxTxExclusion_canRevoke() public {
        token = _deployToken(1);
        token.transfer(alice, 50_000_000 ether);

        token.setMaxTxExclusion(alice, true);
        assertTrue(token.isExcludedFromMaxTx(alice));

        // Revoke the exclusion: alice is now subject to maxTx again.
        token.setMaxTxExclusion(alice, false);
        assertFalse(token.isExcludedFromMaxTx(alice));

        vm.prank(alice);
        vm.expectRevert(Token.ExceedsMaxTx.selector);
        token.transfer(bob, 20_000_000 ether);
    }

    function test_setMaxTxExclusion_emitsEvent() public {
        token = _deployToken(1);

        vm.expectEmit(true, false, false, true, address(token));
        emit Token.MaxTxExclusionUpdated(alice, true);
        token.setMaxTxExclusion(alice, true);

        vm.expectEmit(true, false, false, true, address(token));
        emit Token.MaxTxExclusionUpdated(alice, false);
        token.setMaxTxExclusion(alice, false);
    }

    function test_setMaxTxExclusion_onlyOwner() public {
        token = _deployToken(1);
        vm.prank(alice);
        vm.expectRevert();
        token.setMaxTxExclusion(bob, true);
    }

    // ─── Mint and Burn Skip maxTx ────────────────────────────────────────

    function test_mint_bypassesMaxTx() public {
        // `initialize` mints TOTAL_SUPPLY (1B) to the owner — vastly above
        // maxTxAmount (10M for percent=1). If maxTx was applied to mints
        // (`from == address(0)`), `initialize` itself would revert. Reaching
        // this assertion proves the mint-skip path works.
        token = _deployToken(1);
        assertEq(token.balanceOf(owner), TOTAL_SUPPLY);
    }

    function test_burn_bypassesMaxTx() public {
        token = _deployToken(1);
        token.transfer(alice, 50_000_000 ether);

        // Burn target is `address(0)`, so the maxTx check doesn't apply
        // even though 50M ≫ maxTxAmount (10M).
        token.burn(alice, 50_000_000 ether);
        assertEq(token.balanceOf(alice), 0);
    }

    // ─── setMaxTxPercent ────────────────────────────────────────────────

    function test_setMaxTxPercent_onlyOwner() public {
        token = _deployToken(1);
        vm.prank(alice);
        vm.expectRevert();
        token.setMaxTxPercent(50);
    }

    function test_setMaxTxPercent_updatesAmount() public {
        token = _deployToken(1);
        token.setMaxTxPercent(50);
        assertEq(token.maxTxPercent(), 50);
        assertEq(token.maxTxAmount(), (50 * TOTAL_SUPPLY) / 100);
    }

    function test_setMaxTxPercent_loweringTightensLimit() public {
        // Start permissive (50% = 500M), confirm a 100M transfer works,
        // tighten to 1% (10M), confirm the same transfer now reverts.
        token = _deployToken(50);
        token.transfer(alice, 600_000_000 ether);
        vm.prank(alice);
        token.transfer(bob, 100_000_000 ether);

        token.setMaxTxPercent(1);

        vm.prank(alice);
        vm.expectRevert(Token.ExceedsMaxTx.selector);
        token.transfer(bob, 100_000_000 ether);
    }
}
