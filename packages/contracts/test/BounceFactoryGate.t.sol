// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {IBounceFactory} from "../src/interfaces/IBounceFactory.sol";
import {DeployHelper} from "./DeployHelper.sol";
import {MockBounceFactory} from "./mocks/MockBounceFactory.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";

/// @notice Tests for the BounceTech LT-existence gate added to `Bonding.launch`
///         (issue #268). The gate consults BounceTech's own `Factory.ltExists`
///         on every launch, so a token can only be paired with an LT that
///         BounceTech itself deployed via their `createLt` flow.
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
            salt: _mineVanitySalt(creator)
        });
    }

    // ─── Initialisation ──────────────────────────────────────────────────

    function test_initialize_persistsBounceFactory() public view {
        assertEq(address(bonding.bounceFactory()), address(bounceFactory));
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

    // ─── setBounceFactory admin path ─────────────────────────────────────

    function test_setBounceFactory_onlyOwner() public {
        MockBounceFactory replacement = new MockBounceFactory();
        vm.prank(stranger);
        vm.expectRevert();
        bonding.setBounceFactory(address(replacement));
    }

    function test_setBounceFactory_revertsOnZeroAddress() public {
        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.setBounceFactory(address(0));
    }

    function test_setBounceFactory_emitsAndUpdates() public {
        MockBounceFactory replacement = new MockBounceFactory();
        address old = address(bonding.bounceFactory());

        vm.expectEmit(true, true, false, false);
        emit Bonding.BounceFactoryUpdated(old, address(replacement));
        bonding.setBounceFactory(address(replacement));

        assertEq(address(bonding.bounceFactory()), address(replacement));
    }

    function test_setBounceFactory_appliesToFutureLaunches() public {
        // Old factory recognises `lt`, new one doesn't — switching factories
        // should immediately reject launches against `lt`.
        MockBounceFactory replacement = new MockBounceFactory();
        bonding.setBounceFactory(address(replacement));

        Bonding.LaunchParams memory params = _launchParams(address(lt));
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.UnknownLeveragedToken.selector, address(lt)));
        bonding.launch(params, creator);
    }

    function test_setBounceFactory_doesNotAffectAlreadyLaunchedTokens() public {
        // Token launched while `lt` was registered. We then rotate the
        // BounceTech factory to one that doesn't know about `lt` — the
        // already-launched token must keep trading because the gate only
        // runs in `launch`, not in `buy`/`sell`/`finalizeGraduation`.
        Bonding.LaunchParams memory params = _launchParams(address(lt));
        vm.prank(creator);
        (address tokenAddr,) = bonding.launch(params, creator);

        MockBounceFactory replacement = new MockBounceFactory();
        bonding.setBounceFactory(address(replacement));

        lt.mintDirect(trader, 50 ether);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), 50 ether);
        (uint256 tokensOut,) = bonding.buy(50 ether, tokenAddr, 0, trader);
        vm.stopPrank();

        assertGt(tokensOut, 0, "existing token must keep trading after factory rotation");
    }

    // ─── Reinitializer (upgrade backfill) ────────────────────────────────

    function test_initializeBounceFactory_revertsOnFreshProxyEvenForOwner() public {
        // Closes the front-run window: a fresh-deploy proxy sets
        // `bounceFactory` in `initialize` (so `_initialized == 1`), and
        // `reinitializer(2)` would technically still allow one more call.
        // The `bounceFactory != address(0)` guard rejects the call so an
        // attacker can't swap the gate to a malicious factory between deploy
        // and any other tx.
        MockBounceFactory replacement = new MockBounceFactory();
        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.initializeBounceFactory(address(replacement));
    }

    function test_initializeBounceFactory_cannotBeCalledByStranger() public {
        // Permissionless function (it's gated only by `reinitializer(2)` +
        // the slot guard), so a stranger calling it should revert for the
        // same reason the owner does — slot is already populated. This is
        // intentional: the upgrade keeper can be any wallet because the
        // slot guard, not msg.sender, is the safety net.
        vm.prank(stranger);
        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.initializeBounceFactory(address(0xdead));
    }
}
