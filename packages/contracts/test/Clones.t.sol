// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {DeployHelper} from "./DeployHelper.sol";
import {VanityMining} from "../src/lib/VanityMining.sol";
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

    string internal constant NAME = "CloneTest";
    string internal constant TICKER = "CLN";

    function _params(
        bytes32 salt
    ) internal view returns (Bonding.LaunchParams memory) {
        return Bonding.LaunchParams({
            name: NAME,
            ticker: TICKER,
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: salt
        });
    }

    function _mineForParams(
        address creator_
    ) internal returns (bytes32) {
        return _mineVanitySalt(creator_, NAME, TICKER);
    }

    function test_predictTokenAddress_matchesActualDeployment() public {
        bytes32 userSalt = _mineForParams(creator);

        address predicted = bonding.predictTokenAddress(creator, NAME, TICKER, userSalt);

        vm.prank(creator);
        (address actual,) = bonding.launch(_params(userSalt), creator);

        assertEq(actual, predicted, "predicted address must match deployment");
    }

    function test_predictTokenAddress_differentCreators_differentAddresses() public {
        // Property check (no launch): same userSalt yields different
        // predicted addresses for different creators. This is what
        // `_mixSalt(creator, name, ticker, userSalt)` guarantees, preventing
        // front-running of mined vanity salts. Uses an arbitrary salt —
        // `predictTokenAddress` is a view that doesn't enforce the vanity
        // suffix.
        bytes32 sharedSalt = keccak256("collision-check");
        address predA = bonding.predictTokenAddress(creator, NAME, TICKER, sharedSalt);
        address predB = bonding.predictTokenAddress(trader, NAME, TICKER, sharedSalt);
        assertTrue(predA != predB, "different creators must yield different addresses");

        // Sanity: each creator can launch successfully with their own
        // independently-mined vanity salt and lands at the predicted address.
        bytes32 saltA = _mineForParams(creator);
        bytes32 saltB = _mineForParams(trader);
        address expA = bonding.predictTokenAddress(creator, NAME, TICKER, saltA);
        address expB = bonding.predictTokenAddress(trader, NAME, TICKER, saltB);

        vm.prank(creator);
        (address tokenA,) = bonding.launch(_params(saltA), creator);
        vm.prank(trader);
        (address tokenB,) = bonding.launch(_params(saltB), trader);

        assertEq(tokenA, expA);
        assertEq(tokenB, expB);
        assertTrue(tokenA != tokenB);
    }

    function test_sameCreatorAndSalt_revertsOnSecondLaunch() public {
        bytes32 userSalt = _mineForParams(creator);

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
        bytes32 userSalt = _mineForParams(creator);
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
        bytes32 oldSalt = _mineVanitySaltForImpl(creator, address(tokenImpl), NAME, TICKER);
        address predOld = bonding.predictTokenAddress(creator, NAME, TICKER, oldSalt);

        // Rotate. Existing predictions become stale by design — the frontend
        // re-reads `predictTokenAddress` (and re-mines if needed) after any
        // owner action that could change the impl.
        vm.expectEmit(true, true, false, false);
        emit Bonding.TokenImplementationUpdated(address(tokenImpl), address(newImpl));
        bonding.setTokenImplementation(address(newImpl));

        // The old salt now resolves to a different predicted address (because
        // the initCodeHash baked into CREATE2 changed), and almost certainly
        // not a vanity one.
        address predOldUnderNew = bonding.predictTokenAddress(creator, NAME, TICKER, oldSalt);
        assertTrue(predOld != predOldUnderNew, "rotation must change predicted address");

        // Mine fresh against the NEW impl; that's what the frontend would do.
        bytes32 newSalt = _mineVanitySaltForImpl(creator, address(newImpl), NAME, TICKER);
        address predNew = bonding.predictTokenAddress(creator, NAME, TICKER, newSalt);

        vm.prank(creator);
        (address actual,) = bonding.launch(_params(newSalt), creator);
        assertEq(actual, predNew, "new launches must use new impl");
    }

    function test_setTokenImplementation_revertsOnZeroAddress() public {
        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.setTokenImplementation(address(0));
    }

    /// @notice Rotation MUST reject impls whose `TOTAL_SUPPLY` differs from
    ///         the current one. `_launchTimeVirtualLtReserve` derives the
    ///         launch-time virtual LT reserve as `Pair.k() / TOTAL_SUPPLY`
    ///         on demand, so a rotation that changes `TOTAL_SUPPLY` would
    ///         silently mis-derive the reserve for tokens launched before
    ///         the rotation, breaking their graduation math.
    function test_setTokenImplementation_revertsOnMismatchedTotalSupply() public {
        TokenWithDifferentTotalSupply badImpl = new TokenWithDifferentTotalSupply();
        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.setTokenImplementation(address(badImpl));
    }

    function test_predictTokenAddress_matchesOZHelper() public view {
        // Sanity-check our prediction is byte-identical to the OZ library
        // helper (and therefore to the JS keccak we'll do in the worker).
        // If this ever diverges, the frontend vanity miner is broken.
        bytes32 userSalt = keccak256("oz-check");
        bytes32 mixed = keccak256(abi.encode(creator, keccak256(bytes(NAME)), keccak256(bytes(TICKER)), userSalt));
        address ozPred = Clones.predictDeterministicAddress(address(tokenImpl), mixed, address(bonding));
        assertEq(bonding.predictTokenAddress(creator, NAME, TICKER, userSalt), ozPred);
    }

    // ─── Vanity suffix enforcement ──────────────────────────────────────

    /// @notice Every successful launch's token address must satisfy the
    ///         `Bonding._checkVanity` invariant: the low 20 bits (5 trailing
    ///         hex chars) must all be zero. The mining helper produces
    ///         such a salt by construction; verify that property here so
    ///         any future regression in the helper or the on-chain check
    ///         is caught.
    function test_launch_producesVanityAddress() public {
        bytes32 userSalt = _mineForParams(creator);
        vm.prank(creator);
        (address tokenAddr,) = bonding.launch(_params(userSalt), creator);
        assertEq(uint160(tokenAddr) & 0xfffff, 0, "launched token must end in 5 zero hex chars");
    }

    /// @notice A non-vanity salt must revert with `NotVanityAddress`. Picks
    ///         a salt deterministically known not to land on a `…00000`
    ///         address (the on-chain check is the backstop preventing a
    ///         misbehaving frontend or alternative router from sneaking
    ///         through random fallbacks). With a 20-bit suffix, ~99.9999%
    ///         of random salts qualify, so the very first candidate almost
    ///         always works.
    function test_launch_revertsOnNonVanityAddress() public {
        bytes32 badSalt;
        for (uint256 i = 1; i < 100; ++i) {
            bytes32 candidate = bytes32(i);
            address predicted = bonding.predictTokenAddress(creator, NAME, TICKER, candidate);
            if (uint160(predicted) & 0xfffff != 0) {
                badSalt = candidate;
                break;
            }
        }
        require(badSalt != bytes32(0), "test setup: failed to find non-vanity salt");

        address pred = bonding.predictTokenAddress(creator, NAME, TICKER, badSalt);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.NotVanityAddress.selector, pred));
        bonding.launch(_params(badSalt), creator);
    }

    function test_VANITY_TRAILING_ZEROS_isExpectedConstant() public view {
        // Tripwire: any change to the suffix length breaks the frontend
        // miner and the Solidity test miner in tandem. Force a code review.
        assertEq(bonding.VANITY_TRAILING_ZEROS(), 5);
    }

    /// @notice `bytes32(0)` is a *valid* mining outcome: when `baseSalt = 0`
    ///         and iteration 0 happens to produce a vanity address (~1/1M
    ///         chance per call), `mine()` must return `bytes32(0)` cleanly
    ///         instead of false-reverting with "did not converge". Regression
    ///         for an earlier shape that used `require(found != 0)` as the
    ///         success check, conflating "loop exhausted" with "salt is
    ///         literally zero".
    function test_mine_returnsZeroSaltCleanly() public view {
        bytes32 nameHash = keccak256(bytes("ZeroProbe"));
        bytes32 tickerHash = keccak256(bytes("ZP"));
        address bondingAddr = address(bonding);
        address impl = address(tokenImpl);

        // Brute-force a `creator` such that mixing with `userSalt = 0`
        // produces a vanity-suffixed predicted address. With 1/1,048,576
        // hit probability per creator candidate, ~16M probes is enough to
        // converge with overwhelming likelihood (P(no hit) ≈ exp(-16) ≈ 1e-7).
        // Inline the address derivation in memory-safe assembly so memory
        // doesn't grow per iteration (a naive Solidity loop calling
        // `Clones.predictDeterministicAddress` hits the memory-limit OOG
        // long before convergence).
        address foundCreator = _findZeroSaltCreator(nameHash, tickerHash, impl, bondingAddr);
        require(foundCreator != address(0), "test setup: no creator found that makes salt=0 a vanity hit");

        // Mining with baseSalt=0 must now return bytes32(0) and NOT revert,
        // because iteration 0 (salt = baseSalt + 0 = 0) is the valid hit.
        bytes32 result = VanityMining.mine(foundCreator, nameHash, tickerHash, impl, bondingAddr, bytes32(0));
        assertEq(result, bytes32(0), "mine() must return bytes32(0) when that is the converged salt");
    }

    /// @dev Inline-assembly creator search, structurally identical to
    ///      `VanityMining.mine` but iterating over `creator` (with `salt = 0`
    ///      pinned) instead of `salt`. Reuses fixed scratch buffers so
    ///      memory expansion stays O(1) over the 16 M-iteration budget.
    function _findZeroSaltCreator(
        bytes32 nameHash,
        bytes32 tickerHash,
        address impl,
        address bondingAddr
    ) internal pure returns (address foundCreator) {
        bytes memory prefix = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
        bytes memory suffix = hex"5af43d82803e903d91602b57fd5bf3";
        bytes32 initCodeHash = keccak256(abi.encodePacked(prefix, impl, suffix));
        assembly ("memory-safe") {
            let mixBuf := mload(0x40)
            let addrBuf := add(mixBuf, 0x80)
            mstore(0x40, add(addrBuf, 0x80))

            // mixBuf = abi.encode(creator, nameHash, tickerHash, userSalt=0)
            mstore(add(mixBuf, 0x20), nameHash)
            mstore(add(mixBuf, 0x40), tickerHash)
            mstore(add(mixBuf, 0x60), 0)

            // addrBuf = 0xff || bondingAddr || mixed || initCodeHash
            mstore8(addrBuf, 0xff)
            mstore(add(addrBuf, 1), shl(96, bondingAddr))
            mstore(add(addrBuf, 53), initCodeHash)

            for { let i := 1 } lt(i, 16000000) { i := add(i, 1) } {
                mstore(mixBuf, i)
                let mixed := keccak256(mixBuf, 0x80)
                mstore(add(addrBuf, 21), mixed)
                let predicted := keccak256(addrBuf, 85)
                if iszero(and(predicted, 0xfffff)) {
                    foundCreator := i
                    break
                }
            }
        }
    }

    // ─── Name/ticker binding ─────────────────────────────────────────────

    /// @notice The same `(creator, userSalt)` resolves to *different*
    ///         predicted addresses under different `(name, ticker)` pairs.
    ///         This is what makes a mined salt invalidate the moment the
    ///         launcher edits the symbol/name on the form.
    function test_predictTokenAddress_differentNameOrTicker_differentAddresses() public view {
        bytes32 sharedSalt = keccak256("name-ticker-binding");
        address baseline = bonding.predictTokenAddress(creator, "Foo", "FOO", sharedSalt);
        address altName = bonding.predictTokenAddress(creator, "Bar", "FOO", sharedSalt);
        address altTicker = bonding.predictTokenAddress(creator, "Foo", "BAR", sharedSalt);
        assertTrue(baseline != altName, "name change must alter predicted address");
        assertTrue(baseline != altTicker, "ticker change must alter predicted address");
        assertTrue(altName != altTicker, "name vs ticker changes must not collide");
    }

    /// @notice A salt mined for `(name1, ticker1)` MUST NOT validate against
    ///         a launch carrying any other `(name, ticker)` pair — `launch`
    ///         reverts with `NotVanityAddress` because the mix is bound to
    ///         the metadata. This is the on-chain backstop for the "edited
    ///         the symbol after mining → forced re-mine" UX.
    ///
    ///         We probe a small space of alt-tuples to find ones whose
    ///         predicted address is *not* vanity (~99.9999% per probe with
    ///         a 20-bit suffix), keeping the test deterministic in the face
    ///         of the 1/1,048,576 chance that a random alt-tuple lands on
    ///         a `…00000` address.
    function test_launch_revertsWhenNameOrTickerDifferFromMinedTuple() public {
        bytes32 minedSalt = _mineForParams(creator);

        (string memory altName, string memory altTicker) = _findNonVanityAltTuple(minedSalt);

        // Different ticker: mined salt no longer satisfies the suffix check.
        Bonding.LaunchParams memory tickered = Bonding.LaunchParams({
            name: NAME,
            ticker: altTicker,
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: minedSalt
        });
        address tickeredPred = bonding.predictTokenAddress(creator, NAME, altTicker, minedSalt);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.NotVanityAddress.selector, tickeredPred));
        bonding.launch(tickered, creator);

        // Different name: same outcome.
        Bonding.LaunchParams memory named = Bonding.LaunchParams({
            name: altName,
            ticker: TICKER,
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: minedSalt
        });
        address namedPred = bonding.predictTokenAddress(creator, altName, TICKER, minedSalt);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Bonding.NotVanityAddress.selector, namedPred));
        bonding.launch(named, creator);
    }

    /// @dev Find an `(altName, altTicker)` such that *both* the name-only
    ///      and ticker-only swaps produce non-vanity predicted addresses
    ///      under `creator`/`minedSalt`. With a 20-bit suffix the very
    ///      first probe almost always works.
    function _findNonVanityAltTuple(
        bytes32 minedSalt
    ) internal view returns (string memory altName, string memory altTicker) {
        for (uint256 i = 1; i < 64; ++i) {
            string memory candidateName = string(abi.encodePacked("Alt", vm.toString(i)));
            string memory candidateTicker = string(abi.encodePacked("ALT", vm.toString(i)));
            address namePred = bonding.predictTokenAddress(creator, candidateName, TICKER, minedSalt);
            address tickerPred = bonding.predictTokenAddress(creator, NAME, candidateTicker, minedSalt);
            if (uint160(namePred) & 0xfffff != 0 && uint160(tickerPred) & 0xfffff != 0) {
                return (candidateName, candidateTicker);
            }
        }
        revert("test setup: no non-vanity alt tuple found");
    }
}

/// @dev Minimal stand-in for a `Token` impl with a different `TOTAL_SUPPLY`.
///      Used by `test_setTokenImplementation_revertsOnMismatchedTotalSupply`
///      to exercise the supply-equality guard. Only `TOTAL_SUPPLY` is needed
///      because the guard runs before the `VanityMining` probe.
contract TokenWithDifferentTotalSupply {
    uint256 public constant TOTAL_SUPPLY = 999;
}
