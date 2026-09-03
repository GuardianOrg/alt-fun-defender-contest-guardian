// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bonding} from "../src/Bonding.sol";
import {DeployHelper} from "./DeployHelper.sol";
import {MockBounceFactory} from "./mocks/MockBounceFactory.sol";
import {MockBounceGlobalStorage} from "./mocks/MockBounceGlobalStorage.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";

/// @notice Tests for the BounceTech LT-existence gate added to `Bonding.launch`
///         (issue #268). The gate consults BounceTech's `Factory.ltExists`,
///         resolved live on every launch through their `GlobalStorage.factory()`.
///         Going through `GlobalStorage` (rather than caching the factory
///         address ourselves) means a BounceTech-driven `setFactory` flows
///         through to us automatically with zero ops on our side.
contract BounceFactoryGateTest is DeployHelper {
    address public stranger = makeAddr("stranger");

    function setUp() public {
        _deployCore();
        bonding.addRouter(creator);
        bonding.addRouter(trader);
    }

    function _launchParams(
        address ltAddress
    ) internal returns (Bonding.LaunchParams memory) {
        return Bonding.LaunchParams({
            name: "GateTest",
            ticker: "GATE",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: ltAddress,
            salt: _mineVanitySalt(creator, "GateTest", "GATE")
        });
    }

    // ─── Initialisation ──────────────────────────────────────────────────

    function test_initialize_persistsBounceGlobalStorage() public view {
        assertEq(address(bonding.bounceGlobalStorage()), address(bounceGlobalStorage));
    }

    // ─── Launch gate ─────────────────────────────────────────────────────

    function test_launch_succeedsForRegisteredLT() public {
        // `_deployCore` registers the default mock LT in the factory, so the
        // standard launch path should pass the gate.
        Bonding.LaunchParams memory params = _launchParams(address(lt));
        vm.prank(creator);
        (address tokenAddr,) = bonding.launch(params, creator);
        assertTrue(tokenAddr != address(0));
    }

    function test_launch_revertsOnUnregisteredLT() public {
        // Brand-new LT that exists on-chain but was never registered with
        // BounceTech — exactly the malicious-LT case described in the issue.
        MockLeveragedToken rogueLT =
            new MockLeveragedToken("Rogue", "ROGUE", LT_EXCHANGE_RATE, 2, true, "ROGUE", address(usdc));

        Bonding.LaunchParams memory params = _launchParams(address(rogueLT));
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.UnknownLeveragedToken.selector, address(rogueLT)));
        bonding.launch(params, creator);
    }

    function test_launch_revertsForLtDeregisteredAfterRegistration() public {
        // BounceTech `redeployLt`s an LT — the old address goes back to
        // `ltExists == false`. We must reject new launches against the
        // dead address even though it was once valid.
        bounceFactory.setLtExists(address(lt), false);

        Bonding.LaunchParams memory params = _launchParams(address(lt));
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.UnknownLeveragedToken.selector, address(lt)));
        bonding.launch(params, creator);
    }

    function test_launch_revertsForEOAClaimingToBeLT() public {
        // An EOA passed as `ltAddress` would also fail the gate because
        // `ltExists` returns false for any unregistered address. This catches
        // copy-paste mistakes (e.g. user pastes their own address) before
        // any state mutation.
        Bonding.LaunchParams memory params = _launchParams(stranger);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.UnknownLeveragedToken.selector, stranger));
        bonding.launch(params, creator);
    }

    // ─── Live factory resolution through GlobalStorage ───────────────────

    function test_launch_picksUpFactoryRotationWithoutAdminAction() public {
        // The whole point of resolving the factory live: BounceTech rotates
        // their factory by calling `GlobalStorage.setFactory`, and the
        // very next `Bonding.launch` reads from the new factory with zero
        // ops on our side.
        MockBounceFactory rotatedFactory = new MockBounceFactory();
        // The new factory does NOT recognise the previously-valid LT.
        bounceGlobalStorage.setFactory(address(rotatedFactory));

        Bonding.LaunchParams memory params = _launchParams(address(lt));
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.UnknownLeveragedToken.selector, address(lt)));
        bonding.launch(params, creator);

        // Register `lt` in the new factory and re-attempt — should now pass.
        rotatedFactory.setLtExists(address(lt), true);
        Bonding.LaunchParams memory params2 = _launchParams(address(lt));
        vm.prank(creator);
        (address tokenAddr,) = bonding.launch(params2, creator);
        assertTrue(tokenAddr != address(0));
    }

    // ─── setBounceGlobalStorage admin path ───────────────────────────────

    function test_setBounceGlobalStorage_onlyOwner() public {
        MockBounceFactory replacementFactory = new MockBounceFactory();
        MockBounceGlobalStorage replacement = new MockBounceGlobalStorage(address(replacementFactory));
        vm.prank(stranger);
        vm.expectRevert();
        bonding.setBounceGlobalStorage(address(replacement));
    }

    function test_setBounceGlobalStorage_revertsOnZeroAddress() public {
        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.setBounceGlobalStorage(address(0));
    }

    function test_setBounceGlobalStorage_emitsAndUpdates() public {
        MockBounceFactory replacementFactory = new MockBounceFactory();
        MockBounceGlobalStorage replacement = new MockBounceGlobalStorage(address(replacementFactory));
        address old = address(bonding.bounceGlobalStorage());

        vm.expectEmit(true, true, false, false);
        emit Bonding.BounceGlobalStorageUpdated(old, address(replacement));
        bonding.setBounceGlobalStorage(address(replacement));

        assertEq(address(bonding.bounceGlobalStorage()), address(replacement));
    }

    function test_setBounceGlobalStorage_appliesToFutureLaunches() public {
        // Old global storage points at a factory that recognises `lt`, new
        // one points at a factory that doesn't — switching should
        // immediately reject launches against `lt`.
        MockBounceFactory emptyFactory = new MockBounceFactory();
        MockBounceGlobalStorage replacement = new MockBounceGlobalStorage(address(emptyFactory));
        bonding.setBounceGlobalStorage(address(replacement));

        Bonding.LaunchParams memory params = _launchParams(address(lt));
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.UnknownLeveragedToken.selector, address(lt)));
        bonding.launch(params, creator);
    }

    function test_setBounceGlobalStorage_doesNotAffectAlreadyLaunchedTokens() public {
        // Token launched while `lt` was registered. We then rotate the
        // BounceTech global storage to one whose factory doesn't know
        // about `lt` — the already-launched token must keep trading
        // because the gate only runs in `launch`, not in
        // `buy`/`sell`/`finalizeGraduation`.
        Bonding.LaunchParams memory params = _launchParams(address(lt));
        vm.prank(creator);
        (address tokenAddr,) = bonding.launch(params, creator);

        MockBounceFactory emptyFactory = new MockBounceFactory();
        MockBounceGlobalStorage replacement = new MockBounceGlobalStorage(address(emptyFactory));
        bonding.setBounceGlobalStorage(address(replacement));

        lt.mintDirect(trader, 50 ether);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), 50 ether);
        (uint256 tokensOut,) = bonding.buy(50 ether, tokenAddr, 0, trader);
        vm.stopPrank();

        assertGt(tokensOut, 0, "existing token must keep trading after global storage rotation");
    }

    // ─── Reinitializer (upgrade backfill) ────────────────────────────────

    function test_initializeBounceGlobalStorage_revertsOnFreshProxyEvenForOwner() public {
        // Closes the front-run window: a fresh-deploy proxy sets
        // `bounceGlobalStorage` in `initialize` (so `_initialized == 1`),
        // and `reinitializer(2)` would technically still allow one more
        // call. The `bounceGlobalStorage != address(0)` guard rejects the
        // call so an attacker can't swap the gate to a malicious global
        // storage between deploy and any other tx.
        MockBounceFactory replacementFactory = new MockBounceFactory();
        MockBounceGlobalStorage replacement = new MockBounceGlobalStorage(address(replacementFactory));
        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.initializeBounceGlobalStorage(address(replacement));
    }

    function test_initializeBounceGlobalStorage_cannotBeCalledByStranger() public {
        // Permissionless function (it's gated only by `reinitializer(2)` +
        // the slot guard), so a stranger calling it should revert for the
        // same reason the owner does — slot is already populated. This is
        // intentional: the upgrade keeper can be any wallet because the
        // slot guard, not msg.sender, is the safety net.
        vm.prank(stranger);
        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.initializeBounceGlobalStorage(address(0xdead));
    }
}
