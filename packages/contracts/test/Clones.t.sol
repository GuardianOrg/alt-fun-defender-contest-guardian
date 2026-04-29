// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {DeployHelper} from "./DeployHelper.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @notice EIP-1167 cloning + vanity-salt behaviour for the launchpad.
///
/// Why this file exists separately from `Bonding.t.sol`:
///   `Bonding.t.sol` exercises the *business* layer (curve math, fees, graduation)
///   on top of cloned tokens. The address-derivation correctness — i.e. that
///   `predictTokenAddress` matches the address actually deployed by `launch`,
///   that the same `userSalt` from two different creators *doesn't* collide,
///   that the same `userSalt` from one creator *does* collide on the second
///   call, and that the on-chain vanity suffix invariant is enforced — is
///   the contract surface that the frontend vanity miner is coupled to, so
///   it gets its own focused suite.
contract ClonesTest is DeployHelper {
    function setUp() public {
        _deployCore();
        bonding.addRouter(creator);
        bonding.addRouter(trader);
    }

    function _params(
        bytes32 salt
    ) internal view returns (Bonding.LaunchParams memory) {
        return Bonding.LaunchParams({
            name: "CloneTest",
            ticker: "CLN",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: salt
        });
    }

    function test_predictTokenAddress_matchesActualDeployment() public {
        bytes32 userSalt = _mineVanitySalt(creator);

        address predicted = bonding.predictTokenAddress(creator, userSalt);

        vm.prank(creator);
        (address actual,) = bonding.launch(_params(userSalt), creator);

        assertEq(actual, predicted, "predicted address must match deployment");
    }

    function test_predictTokenAddress_differentCreators_differentAddresses() public {
        // Property check (no launch): same userSalt yields different
        // predicted addresses for different creators. This is what
        // `_mixSalt(creator, userSalt)` guarantees, preventing front-running
        // of mined vanity salts. Uses an arbitrary salt — `predictTokenAddress`
        // is a view that doesn't enforce the vanity suffix.
        bytes32 sharedSalt = keccak256("collision-check");
        address predA = bonding.predictTokenAddress(creator, sharedSalt);
        address predB = bonding.predictTokenAddress(trader, sharedSalt);
        assertTrue(predA != predB, "different creators must yield different addresses");

        // Sanity: each creator can launch successfully with their own
        // independently-mined vanity salt and lands at the predicted address.
        bytes32 saltA = _mineVanitySalt(creator);
        bytes32 saltB = _mineVanitySalt(trader);
        address expA = bonding.predictTokenAddress(creator, saltA);
        address expB = bonding.predictTokenAddress(trader, saltB);

        vm.prank(creator);
        (address tokenA,) = bonding.launch(_params(saltA), creator);
        vm.prank(trader);
        (address tokenB,) = bonding.launch(_params(saltB), trader);

        assertEq(tokenA, expA);
        assertEq(tokenB, expB);
        assertTrue(tokenA != tokenB);
    }

    function test_sameCreatorAndSalt_revertsOnSecondLaunch() public {
        bytes32 userSalt = _mineVanitySalt(creator);

        vm.prank(creator);
        bonding.launch(_params(userSalt), creator);

        // OZ Clones.cloneDeterministic reverts with FailedDeployment when the
        // target CREATE2 address already has code. We don't pin the selector
        // here — both library versions and Foundry decode it differently —
        // we just want to know the second deploy doesn't silently overwrite.
        vm.prank(creator);
        vm.expectRevert();
        bonding.launch(_params(userSalt), creator);
    }

    function test_clone_initializerCannotBeCalledTwice() public {
        bytes32 userSalt = _mineVanitySalt(creator);
        vm.prank(creator);
        (address tokenAddr,) = bonding.launch(_params(userSalt), creator);

        // The clone's initialize() runs once during launch(). A second call
        // must revert (OZ Initializable). This protects against a malicious
        // re-init wiping the owner.
        vm.expectRevert();
        Token(tokenAddr).initialize("Evil", "EVL", address(this));
    }

    function test_implementation_isLocked() public {
        // The implementation contract calls `_disableInitializers()` in its
        // constructor, so initialise() must always revert on it. Without this
        // anyone could call initialize() on the impl and grief future clones
        // (in OZ <5 this matters more, but the lock is still good hygiene).
        bool reverted;
        try Token(address(tokenImpl)).initialize("X", "X", address(this)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        assertTrue(reverted, "implementation must be init-locked");
    }

    function test_setTokenImplementation_onlyOwner() public {
        Token newImpl = new Token();

        vm.prank(creator);
        vm.expectRevert();
        bonding.setTokenImplementation(address(newImpl));
    }

    function test_setTokenImplementation_updatesAndAffectsFutureLaunches() public {
        Token newImpl = new Token();

        // Mine against the OLD impl, capture predicted address.
        bytes32 oldSalt = _mineVanitySaltForImpl(creator, address(tokenImpl));
        address predOld = bonding.predictTokenAddress(creator, oldSalt);

        // Rotate. Existing predictions become stale by design — the frontend
        // re-reads `predictTokenAddress` (and re-mines if needed) after any
        // owner action that could change the impl.
        vm.expectEmit(true, true, false, false);
        emit Bonding.TokenImplementationUpdated(address(tokenImpl), address(newImpl));
        bonding.setTokenImplementation(address(newImpl));

        // The old salt now resolves to a different predicted address (because
        // the initCodeHash baked into CREATE2 changed), and almost certainly
        // not a vanity one.
        address predOldUnderNew = bonding.predictTokenAddress(creator, oldSalt);
        assertTrue(predOld != predOldUnderNew, "rotation must change predicted address");

        // Mine fresh against the NEW impl; that's what the frontend would do.
        bytes32 newSalt = _mineVanitySaltForImpl(creator, address(newImpl));
        address predNew = bonding.predictTokenAddress(creator, newSalt);

        vm.prank(creator);
        (address actual,) = bonding.launch(_params(newSalt), creator);
        assertEq(actual, predNew, "new launches must use new impl");
    }

    function test_setTokenImplementation_revertsOnZeroAddress() public {
        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.setTokenImplementation(address(0));
    }

    function test_predictTokenAddress_matchesOZHelper() public view {
        // Sanity-check our prediction is byte-identical to the OZ library
        // helper (and therefore to the JS keccak we'll do in the worker).
        // If this ever diverges, the frontend vanity miner is broken.
        bytes32 userSalt = keccak256("oz-check");
        bytes32 mixed = keccak256(abi.encode(creator, userSalt));
        address ozPred = Clones.predictDeterministicAddress(address(tokenImpl), mixed, address(bonding));
        assertEq(bonding.predictTokenAddress(creator, userSalt), ozPred);
    }

    // ─── Vanity suffix enforcement ──────────────────────────────────────

    /// @notice Every successful launch's token address must end in the
    ///         `Bonding.VANITY_SUFFIX` (`0xa1fa`). The mining helper produces
    ///         such a salt by construction; we explicitly verify that
    ///         property here so any future regression in either the helper
    ///         or the on-chain check is caught.
    function test_launch_producesVanityAddress() public {
        bytes32 userSalt = _mineVanitySalt(creator);
        vm.prank(creator);
        (address tokenAddr,) = bonding.launch(_params(userSalt), creator);
        assertEq(
            bytes2(uint16(uint160(tokenAddr))), bonding.VANITY_SUFFIX(), "launched token must end in VANITY_SUFFIX"
        );
    }

    /// @notice A non-vanity salt must revert with `NotVanityAddress`. Picks
    ///         a salt deterministically known not to mine to `0xa1fa` (the
    ///         on-chain check is the backstop preventing a misbehaving
    ///         frontend or alternative router from sneaking through random
    ///         fallbacks).
    function test_launch_revertsOnNonVanityAddress() public {
        // Brute-force a salt that *isn't* vanity. With a 16-bit suffix,
        // ~65,535 in 65,536 random salts qualify, so the very first
        // candidate almost always works.
        bytes32 badSalt;
        for (uint256 i = 1; i < 100; ++i) {
            bytes32 candidate = bytes32(i);
            address predicted = bonding.predictTokenAddress(creator, candidate);
            if (bytes2(uint16(uint160(predicted))) != bonding.VANITY_SUFFIX()) {
                badSalt = candidate;
                break;
            }
        }
        require(badSalt != bytes32(0), "test setup: failed to find non-vanity salt");

        address pred = bonding.predictTokenAddress(creator, badSalt);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.NotVanityAddress.selector, pred));
        bonding.launch(_params(badSalt), creator);
    }

    function test_VANITY_SUFFIX_isExpectedConstant() public view {
        // Tripwire: any change to the suffix bytes breaks the frontend miner
        // and the Solidity test miner in tandem. Force a code review.
        assertEq(bonding.VANITY_SUFFIX(), bytes2(0xa1fa));
    }
}
