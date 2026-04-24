// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {FERC20} from "../src/FERC20.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {LPLock} from "../src/LPLock.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";
import {MockHyperswapRouter} from "./mocks/MockHyperswapRouter.sol";

/// @notice Shared deployment wiring for Bonding-based test suites.
/// Deploys mocks, factory, router, LPLock proxy, Bonding proxy, and FeeVault proxy with roles configured.
/// Subclasses should call `_deployCore()` in their `setUp()` and then perform any additional setup.
abstract contract DeployHelper is Test {
    MockERC20 public usdc;
    MockLeveragedToken public lt;
    MockHyperswapRouter public hyperswapRouter;
    FFactory public factory;
    FRouter public frouter;
    Bonding public bonding;
    LPLock public lpLockContract;
    FeeVault public feeVault;
    FERC20 public ferc20Impl;

    address public owner = address(this);
    address public feeReceiver = makeAddr("feeReceiver");
    address public creator = makeAddr("creator");
    address public trader = makeAddr("trader");
    address public trader2 = makeAddr("trader2");

    uint256 constant MAX_TX = 100; // 100% = no limit
    uint256 constant LT_EXCHANGE_RATE = 1 ether; // 1 LT = $1 USD

    /// @dev Per-test salt counter so successive `_mineVanitySalt` calls in
    ///      a single test pick up where the previous one left off. Tests
    ///      that build a `LaunchParams` literal directly must use
    ///      `_mineVanitySalt(creator_)` for the `salt` field — every
    ///      launched token must end in `Bonding.VANITY_SUFFIX` and the
    ///      contract reverts otherwise.
    uint256 internal _saltNonce;

    /// @dev EIP-1167 minimal-proxy *creation*-code prefix/suffix, in the
    ///      OpenZeppelin v5 layout used by `Clones.cloneDeterministic`
    ///      (longer suffix than the original spec — see notes in
    ///      `packages/shared/src/vanity.ts`). Embedded here so the test
    ///      miner can compute CREATE2 addresses without round-tripping
    ///      through the OZ library on every iteration.
    bytes constant _EIP1167_PREFIX = hex"3d602d80600a3d3981f3363d3d373d3d3d363d73";
    bytes constant _EIP1167_SUFFIX = hex"5af43d82803e903d91602b57fd5bf3";

    /// @dev Brute-force a `userSalt` such that
    ///      `Clones.cloneDeterministic(ferc20Impl, _mixSalt(creator_, userSalt))`
    ///      deploys to an address ending in `Bonding.VANITY_SUFFIX`
    ///      (`0xa1fa`). Mirrors the off-chain Web Worker miner used by the
    ///      frontend. ~65k attempts on average — Foundry's revm runs this
    ///      in tens of ms per launch.
    ///
    ///      Non-view because we tick `_saltNonce` so successive launches in
    ///      a single test (with the same creator) get fresh starting points
    ///      and don't waste cycles re-mining the same range.
    function _mineVanitySalt(
        address creator_
    ) internal returns (bytes32) {
        // IMPORTANT: this helper must NOT make any external calls — the
        // calling test commonly does `vm.prank(creator); doStuff(_mineVanitySalt(...))`,
        // and any call here would consume the prank before `doStuff` runs.
        // We use the cached `ferc20Impl` set at deploy time. Tests that
        // rotate `tokenImplementation` mid-test must call
        // `_mineVanitySaltForImpl(creator_, newImpl)` explicitly.
        return _mineVanitySaltForImpl(creator_, address(ferc20Impl));
    }

    function _mineVanitySaltForImpl(
        address creator_,
        address implementation_
    ) internal returns (bytes32 found) {
        // Pre-compute the EIP-1167 initCodeHash for `implementation_` —
        // constant for the entire mining loop, so we hash it once.
        bytes32 initCodeHash = keccak256(abi.encodePacked(_EIP1167_PREFIX, implementation_, _EIP1167_SUFFIX));

        ++_saltNonce;
        bytes32 baseSalt = keccak256(abi.encode("vanity-mine-base", _saltNonce, creator_, implementation_));
        address bondingAddr = address(bonding);

        // Fully assembly-driven hot loop: reuses two 64- and 85-byte buffers
        // in scratch memory so memory expansion cost stays at O(1) instead
        // of O(N) — without this, ~65k iterations blow past the EVM memory
        // gas limit (`MemoryOOG`).
        //
        // `mixBuf` (64 bytes): [creator (32) | salt (32)]  → keccak → mixed
        // `addrBuf` (85 bytes): [0xff | bonding (20) | mixed (32) | initHash (32)]
        //                        → keccak → predicted address
        assembly ("memory-safe") {
            let mixBuf := mload(0x40)
            let addrBuf := add(mixBuf, 0x40)
            mstore(0x40, add(addrBuf, 0x80)) // bump free pointer once

            // Static fields in mixBuf.
            mstore(mixBuf, creator_) // address right-aligned in 32 bytes

            // Static fields in addrBuf. The 0xff prefix lives in the high
            // byte of the first word; bonding is 20 bytes packed after it,
            // so the 32-byte word at offset 0 is `0xff | bondingAddr` with
            // 11 leading zero bytes between them. We instead use the
            // standard layout: byte 0 = 0xff, bytes 1..20 = bonding, bytes
            // 21..52 = mixed, bytes 53..84 = initCodeHash. Then
            // keccak256(addrBuf, 85).
            mstore8(addrBuf, 0xff)
            // Pack bonding into bytes [1..20]. Address sits in low 20 bytes
            // of a word, so shift left by (32-20-1)*8 = 88 bits to align.
            mstore(add(addrBuf, 1), shl(96, bondingAddr))
            // initCodeHash at bytes [53..84].
            mstore(add(addrBuf, 53), initCodeHash)

            for { let i := 0 } lt(i, 1000000) { i := add(i, 1) } {
                // userSalt = baseSalt + i (overflow-wrapped, fine).
                let salt := add(baseSalt, i)
                mstore(add(mixBuf, 0x20), salt)
                let mixed := keccak256(mixBuf, 0x40)
                mstore(add(addrBuf, 21), mixed)
                let predicted := keccak256(addrBuf, 85)
                // Address is the low 20 bytes of `predicted`. We want the
                // last 2 bytes to equal 0xa1fa. Mask out everything but the
                // low 16 bits and compare.
                if eq(and(predicted, 0xffff), 0xa1fa) {
                    found := salt
                    break
                }
            }
        }

        require(found != bytes32(0), "DeployHelper: vanity mining did not converge in 1M attempts");
    }

    /// @notice Deploys all core contracts and wires roles. Does NOT allowlist any
    /// router on Bonding — callers must do that themselves (e.g. `bonding.addRouter(...)`).
    /// Suites that call `bonding.buy/sell/launch` directly should allowlist the
    /// pranked address as a router.
    function _deployCore() internal {
        usdc = new MockERC20("USD Coin", "USDC");
        lt = new MockLeveragedToken("HYPE 2x Long", "HYPE2L", LT_EXCHANGE_RATE, 2, true, "HYPE", address(usdc));
        hyperswapRouter = new MockHyperswapRouter();

        factory = new FFactory();
        factory.initialize();

        frouter = new FRouter();
        frouter.initialize(address(factory));

        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (owner));
        lpLockContract = LPLock(address(new ERC1967Proxy(address(lpLockImpl), lpLockInit)));

        ferc20Impl = new FERC20();

        Bonding bondingImpl = new Bonding();
        bytes memory bondingInit = abi.encodeCall(
            Bonding.initialize,
            (
                address(factory),
                address(frouter),
                MAX_TX,
                address(hyperswapRouter),
                address(lpLockContract),
                address(ferc20Impl)
            )
        );
        bonding = Bonding(address(new ERC1967Proxy(address(bondingImpl), bondingInit)));

        FeeVault feeVaultImpl = new FeeVault();
        bytes memory feeVaultInit = abi.encodeCall(FeeVault.initialize, (address(usdc), feeReceiver));
        feeVault = FeeVault(address(new ERC1967Proxy(address(feeVaultImpl), feeVaultInit)));

        factory.setRouter(address(frouter));
        factory.grantRole(factory.BONDING_ROLE(), address(bonding));
        frouter.grantRole(frouter.BONDING_ROLE(), address(bonding));
        lpLockContract.setLocker(address(bonding), true);
    }
}
