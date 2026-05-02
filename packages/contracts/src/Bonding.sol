// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Factory} from "./Factory.sol";
import {Router} from "./Router.sol";
import {Token} from "./Token.sol";
import {IBounceFactory} from "./interfaces/IBounceFactory.sol";
import {IBounceGlobalStorage} from "./interfaces/IBounceGlobalStorage.sol";
import {IBounceLeveragedToken} from "./interfaces/IBounceLeveragedToken.sol";
import {IPair} from "./interfaces/IPair.sol";
import {IUniswapV2Factory} from "./interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "./interfaces/IUniswapV2Pair.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {LPLock} from "./LPLock.sol";
import {VanityMining} from "./lib/VanityMining.sol";

/// @title Bonding
/// @notice Constant-product bonding curve for the launchpad. Each token pairs with a
///         BounceTech Leveraged Token (LT) as its reserve asset.
/// @dev Forked from Virtuals Protocol `Bonding.sol`. Full design (virtual reserves,
///      dual-trigger graduation, two-phase split, dynamic LP seeding, brick-resistance
///      invariants) lives in `packages/contracts/AGENTS.md` and `docs/contracts-scope.md`.
///      Read those before touching `_enterGraduating`, `finalizeGraduation`, or
///      `_prepareGraduationLiquidity`.
/// @dev Owner is the protocol multisig. Uses `Ownable2StepUpgradeable` so a
///      bad `transferOwnership` can be cancelled (or simply ignored by the
///      pending owner) before it takes effect — single-step transfer to a
///      fat-fingered or contract-incompatible address would otherwise brick
///      every owner-only path on the live proxy.
///
///      Storage uses ERC-7201 namespaced layout (no `__gap` needed). All
///      mutable state lives in `BondingStorage` at
///      `_BONDING_STORAGE_LOCATION`. See
///      `packages/contracts/AGENTS.md#storage-layout`.
contract Bonding is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant VIRTUAL_LIQUIDITY_USD = 4_000 ether;

    uint256 public constant CURVE_BPS = 7500;
    uint256 public constant LP_RESERVE_BPS = 2500;
    uint256 public constant BPS_DENOM = 10_000;

    uint256 public constant LP_RESERVE = (1_000_000_000 ether * LP_RESERVE_BPS) / BPS_DENOM;

    /// @dev Name/ticker bounds mirror Pump.fun so tokens render consistently in
    ///      cross-launchpad aggregators (DEXScreener, Birdeye) that size UI off
    ///      the longest name they've indexed. Webapp/API replicate.
    uint256 public constant MIN_NAME_LENGTH = 1;
    uint256 public constant MAX_NAME_LENGTH = 34;
    uint256 public constant MIN_TICKER_LENGTH = 1;
    uint256 public constant MAX_TICKER_LENGTH = 10;

    /// @dev DoS guards on optional metadata. Without them a caller could push
    ///      multi-MB strings into the launch tx. Webapp/API replicate
    ///      pre-flight so users get a clean validation error.
    uint256 public constant MAX_DESCRIPTION_LENGTH = 8000;
    uint256 public constant MAX_IMAGE_LENGTH = 512;
    uint256 public constant MAX_URL_LENGTH = 512;

    /// @dev Number of trailing hex zeros required on every launched token
    ///      address — addresses always render as `0x…00000`. Hex digits 0-9
    ///      render identically regardless of EIP-55 checksum casing, so the
    ///      check is a single bitwise mask: no second keccak, no per-launch
    ///      EIP-55 dance. Mining cost ≈ 1 M attempts (~1 s background on
    ///      typical hardware via the JS worker pool).
    ///
    ///      The on-chain mask `_VANITY_MASK` below derives from this
    ///      constant so they cannot drift apart. If you change the length
    ///      here you MUST also update the matching `VANITY_SUFFIX` string
    ///      in `packages/shared/src/vanity.ts` and the `TRAILING_ZEROS`
    ///      mirror in `VanityMining.sol`. Diverging any of those bricks
    ///      token creation.
    uint256 public constant VANITY_TRAILING_ZEROS = 5;

    /// @dev Bitmask covering the low `(VANITY_TRAILING_ZEROS * 4)` bits of
    ///      an address — `0xfffff` for the production length of 5. Folded
    ///      to a literal at compile time by Solidity since both operands
    ///      are `constant`, so there's no runtime cost vs hardcoding.
    uint256 private constant _VANITY_MASK = (uint256(1) << (VANITY_TRAILING_ZEROS * 4)) - 1;

    /// @notice Anti-snipe trading delay. After `launch()`, public buys on the
    ///         curve are blocked for `LAUNCH_TRADING_DELAY_BLOCKS` blocks (so
    ///         trading opens at `launchBlock + LAUNCH_TRADING_DELAY_BLOCKS + 1`).
    ///         The seed buy attached to the launch tx bypasses the gate via
    ///         the transient flag set in `launch()` — see `buy()` for the
    ///         consume-once mechanic. Combined with `Zap.MIN_SEED_USDC`, this
    ///         is the system's first-block-sniper mitigation: the creator's
    ///         seed absorbs the cheap end of the curve, and no other buyer
    ///         can race them into block N or pile in at N+1..N+3.
    uint256 public constant LAUNCH_TRADING_DELAY_BLOCKS = 3;

    /// @dev Transient-storage slot keying the seed-buy bypass. Set in
    ///      `launch()` to the freshly-deployed token address, consumed by the
    ///      first matching `buy()` call in the same tx (i.e. the seed buy
    ///      Zap fires immediately after launch). Naturally cleared at
    ///      end-of-tx, so it cannot leak across txs even if a bug skips the
    ///      consume. Keyed off a domain-separated label to avoid collisions
    ///      with any future transient slots elsewhere in the contract.
    bytes32 private constant _SEED_BUY_BYPASS_SLOT = keccak256("alt-fun.bonding.seedBuyBypass.v1");

    /// @notice Strictly-forward lifecycle: `Curve → Graduating → Graduated`.
    enum Lifecycle {
        Curve,
        Graduating,
        Graduated
    }

    struct TokenInfo {
        address creator;
        address pair;
        address ltAddress;
        string name;
        string ticker;
        string description;
        string image;
        string[3] urls;
        Lifecycle lifecycle;
    }

    /// @notice Snapshot of LP-bound amounts cached at end of phase 1, consumed
    ///         by `finalizeGraduation`, deleted on success.
    /// @dev    `ltFromPair` is held as `uint256` (not narrower) because token
    ///         creation is permissionless and a malicious LT returning a tiny
    ///         `exchangeRate` could legitimately push it past 2^128 — a
    ///         narrowing cast would strand real LT in phase 2.
    /// @dev    No `pendingSince` / freshness timestamp by design — see the
    ///         "exchange-rate drift between phase 1 and phase 2" note on
    ///         `finalizeGraduation` for the audit-acceptance rationale.
    struct PendingGraduation {
        uint256 tokensForLP;
        uint256 ltFromPair;
        uint256 lpBurned;
        uint256 unsoldBurned;
    }

    struct LaunchParams {
        string name;
        string ticker;
        string description;
        string image;
        string[3] urls;
        address ltAddress;
        /// @dev User-supplied vanity salt. Mixed with the creator address,
        ///      `keccak256(bytes(name))`, and `keccak256(bytes(ticker))` in
        ///      `_mixSalt`. Binding the mix to the metadata means a salt mined
        ///      for one `(creator, name, ticker)` triple cannot be reused if
        ///      the launcher edits the symbol/name afterwards — they must
        ///      mine again — and a mined salt observed in the mempool cannot
        ///      be front-run by a different creator.
        bytes32 salt;
    }

    /// @custom:storage-location erc7201:altfun.storage.Bonding
    struct BondingStorage {
        Factory factory;
        Router router;
        /// @dev Set once at `initialize` and immutable thereafter — there is
        ///      no live setter. Hot-swapping the post-graduation venue or LP
        ///      lock would let an admin silently reroute any token already
        ///      in `Lifecycle.Graduating` between phase 1 and
        ///      `finalizeGraduation`. Migrating to a new HyperSwap fork or
        ///      LP lock requires a UUPS upgrade so the change is visible
        ///      on-chain ahead of time.
        address uniswapV2Factory;
        address lpLock;
        /// @dev EIP-1167 implementation cloned by `launch()`. Hot-swappable
        ///      for future launches via `setTokenImplementation`;
        ///      already-deployed clones bake in the impl address at deploy
        ///      time and are unaffected.
        address tokenImplementation;
        /// @dev Authorised routers (Zaps). Set-based so a new Zap can be
        ///      allowlisted before the old one is removed, giving
        ///      zero-downtime router rotations.
        EnumerableSet.AddressSet routers;
        /// @dev Graduation fires when real LT reserve × exchangeRate ≥ this.
        ///      Set once at `initialize` and immutable thereafter: a live
        ///      setter would let an MEV searcher sandwich the parameter
        ///      change against every currently-trading token (issue #269).
        ///      Tuning requires a UUPS upgrade with a `reinitializer`.
        uint256 graduationThresholdUsd;
        mapping(address token => TokenInfo) tokenInfo;
        mapping(address token => address) graduatedPair;
        mapping(address token => PendingGraduation) pendingGraduation;
        /// @dev BounceTech `GlobalStorage`, queried per-launch to resolve the
        ///      live `Factory` and reject non-BounceTech LTs (which could
        ///      otherwise siphon buyer USDC inside `mint`). Going through
        ///      `GlobalStorage` means BounceTech `setFactory` rotations flow
        ///      through automatically.
        IBounceGlobalStorage bounceGlobalStorage;
        /// @notice Block in which each token was launched. Combined with
        ///         `LAUNCH_TRADING_DELAY_BLOCKS` to gate post-launch buys
        ///         against first-block snipers — see `buy()` for the full
        ///         rationale.
        /// @dev `uint64` is enough for any realistic chain age (>500 years
        ///      at 1s blocks) and packs four launches per slot.
        mapping(address token => uint64) launchBlock;
        /// @dev V2 router used in the hostile-pre-seed defense path of
        ///      `_seedUniswapV2Direct` (issue #308). Set at `initialize`
        ///      and immutable thereafter — rotation requires a UUPS
        ///      upgrade so the change is visible on-chain ahead of any
        ///      in-flight graduation, same contract as `uniswapV2Factory`.
        ///      The empty-pair fast path bypasses the router entirely.
        address uniswapV2Router;
    }

    // keccak256(abi.encode(uint256(keccak256("altfun.storage.Bonding")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _BONDING_STORAGE_LOCATION =
        0x8b5754e13e604f53718538385c40d9546a4725ba57a2e3447377e5a0d65c8e00;

    function _s() private pure returns (BondingStorage storage $) {
        assembly {
            $.slot := _BONDING_STORAGE_LOCATION
        }
    }

    event TokenLaunched(
        address indexed token, address indexed creator, address indexed ltAddress, string name, string ticker, uint256 k
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool indexed isBuy,
        uint256 ltAmount,
        uint256 tokenAmount,
        uint256 newCurveSupply,
        uint256 newLtReserve
    );
    /// @notice Phase 1 of graduation fired. Trading frozen; `finalizeGraduation`
    ///         now callable to seed the V2 LP.
    event TokenGraduating(
        address indexed token, uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned
    );
    event TokenGraduated(
        address indexed token,
        address indexed pairAddress,
        uint256 liquidity,
        uint256 tokensInLP,
        uint256 lpBurned,
        uint256 unsoldBurned
    );
    event CreatorTransferred(address indexed token, address indexed oldCreator, address indexed newCreator);
    event RouterAdded(address indexed router);
    event RouterRemoved(address indexed router);
    event TokenImplementationUpdated(address indexed oldImpl, address indexed newImpl);
    event BounceGlobalStorageUpdated(address indexed oldGlobalStorage, address indexed newGlobalStorage);
    /// @notice Emitted by `rescueLT` so the destination of any LT sweep
    ///         is observable on-chain (the function takes an arbitrary `to`).
    event LTRescued(address indexed token, address indexed to, uint256 amount);

    error TokenNotTrading();
    /// @dev Distinct from `TokenNotTrading` so the UI can render a "graduating"
    ///      overlay rather than a generic error.
    error TokenIsGraduating();
    error NotGraduating();
    error ZeroAddress();
    error InvalidInput();
    error SlippageExceeded();
    error NotCreator();
    error NotRouter();
    error RouterAlreadyAdded();
    error RouterNotFound();
    error MustKeepOneRouter();
    error ZeroExchangeRate();
    error InvalidNameLength();
    error InvalidTickerLength();
    error InvalidDescriptionLength();
    error InvalidImageLength();
    error InvalidUrlLength();
    error NotVanityAddress(address tokenAddr);
    /// @dev `ltAddress` not in the BounceTech `Factory.ltExists` mapping
    ///      (arbitrary contract, or an LT BounceTech has since `redeployLt`'d).
    error UnknownLeveragedToken(address ltAddress);
    /// @dev Buy attempted before `launchBlock + LAUNCH_TRADING_DELAY_BLOCKS`
    ///      without the seed-buy transient bypass — i.e. a sniper trying to
    ///      front-run public trading. See `LAUNCH_TRADING_DELAY_BLOCKS`.
    error TradingNotOpen();

    modifier onlyRouter() {
        if (!_s().routers.contains(msg.sender)) revert NotRouter();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /// @param graduationThresholdUsd_ Immutable USD trigger (18-dp). Must be
    ///        ≥ `VIRTUAL_LIQUIDITY_USD` so a fresh curve can't be pre-graduated.
    function initialize(
        address factory_,
        address router_,
        address uniswapV2Factory_,
        address uniswapV2Router_,
        address lpLock_,
        address tokenImplementation_,
        uint256 graduationThresholdUsd_,
        address bounceGlobalStorage_
    ) external initializer {
        if (
            factory_ == address(0) || router_ == address(0) || uniswapV2Factory_ == address(0)
                || uniswapV2Router_ == address(0) || lpLock_ == address(0) || tokenImplementation_ == address(0)
                || bounceGlobalStorage_ == address(0)
        ) revert ZeroAddress();
        if (graduationThresholdUsd_ < VIRTUAL_LIQUIDITY_USD) revert InvalidInput();
        __Ownable_init(msg.sender);

        BondingStorage storage $ = _s();
        $.factory = Factory(factory_);
        $.router = Router(router_);
        $.uniswapV2Factory = uniswapV2Factory_;
        $.uniswapV2Router = uniswapV2Router_;
        $.lpLock = lpLock_;
        $.tokenImplementation = tokenImplementation_;
        $.graduationThresholdUsd = graduationThresholdUsd_;
        $.bounceGlobalStorage = IBounceGlobalStorage(bounceGlobalStorage_);
    }

    /// @notice Backfill `bounceGlobalStorage` on a proxy deployed before this
    ///         slot existed. Invoked atomically via `upgradeToAndCall`. The
    ///         `address(0)` guard closes the reinitializer-front-run window on
    ///         fresh proxies that haven't been initialised yet.
    function initializeBounceGlobalStorage(
        address bounceGlobalStorage_
    ) external reinitializer(2) {
        if (bounceGlobalStorage_ == address(0)) revert ZeroAddress();
        BondingStorage storage $ = _s();
        if (address($.bounceGlobalStorage) != address(0)) revert InvalidInput();
        $.bounceGlobalStorage = IBounceGlobalStorage(bounceGlobalStorage_);
        emit BounceGlobalStorageUpdated(address(0), bounceGlobalStorage_);
    }

    // ─── Launch ──────────────────────────────────────────────────────────

    function launch(
        LaunchParams calldata params,
        address creator_
    ) external onlyRouter nonReentrant returns (address tokenAddr, address pair) {
        if (params.ltAddress == address(0)) revert InvalidInput();
        BondingStorage storage $ = _s();
        // `Zap.createToken` is permissionless; without this gate a fake LT
        // could siphon USDC inside `mint` (which `Zap` `forceApprove`s).
        if (!IBounceFactory($.bounceGlobalStorage.factory()).ltExists(params.ltAddress)) {
            revert UnknownLeveragedToken(params.ltAddress);
        }

        uint256 nameLen = bytes(params.name).length;
        if (nameLen < MIN_NAME_LENGTH || nameLen > MAX_NAME_LENGTH) revert InvalidNameLength();
        uint256 tickerLen = bytes(params.ticker).length;
        if (tickerLen < MIN_TICKER_LENGTH || tickerLen > MAX_TICKER_LENGTH) revert InvalidTickerLength();
        if (bytes(params.description).length > MAX_DESCRIPTION_LENGTH) revert InvalidDescriptionLength();
        if (bytes(params.image).length > MAX_IMAGE_LENGTH) revert InvalidImageLength();
        for (uint256 i = 0; i < 3; i++) {
            if (bytes(params.urls[i]).length > MAX_URL_LENGTH) revert InvalidUrlLength();
        }

        bytes32 saltMixed = _mixSalt(creator_, params.name, params.ticker, params.salt);
        tokenAddr = Clones.predictDeterministicAddress($.tokenImplementation, saltMixed, address(this));
        _checkVanity(tokenAddr);

        _storeTokenInfo(tokenAddr, address(0), params, creator_);

        pair = _deployAndSeed(tokenAddr, saltMixed, params.name, params.ticker, params.ltAddress);
        $.tokenInfo[tokenAddr].pair = pair;
        // forge-lint: disable-next-line(unsafe-typecast)
        $.launchBlock[tokenAddr] = uint64(block.number);

        // Arm the seed-buy bypass: the first `buy()` in this tx targeting this
        // token skips the launch trading delay. Routers (Zap) immediately
        // follow `launch()` with the seed buy, so the creator's seed lands
        // before the gate engages while same-block sniper buys (separate
        // txs, transient cleared) are blocked.
        bytes32 slot = _SEED_BUY_BYPASS_SLOT;
        assembly {
            tstore(slot, tokenAddr)
        }

        uint256 k = IPair(pair).k();
        emit TokenLaunched(tokenAddr, creator_, params.ltAddress, params.name, params.ticker, k);
    }

    function _deployAndSeed(
        address tokenAddr,
        bytes32 saltMixed,
        string calldata name_,
        string calldata ticker_,
        address ltAddress
    ) internal returns (address pair) {
        BondingStorage storage $ = _s();
        Clones.cloneDeterministic($.tokenImplementation, saltMixed);

        Token(tokenAddr).initialize(name_, ticker_, address(this));

        uint256 totalSupply = Token(tokenAddr).TOTAL_SUPPLY();
        uint256 curveSupply = (totalSupply * CURVE_BPS) / BPS_DENOM;

        pair = $.factory.createPair(tokenAddr, ltAddress);

        uint256 exchangeRate = IBounceLeveragedToken(ltAddress).exchangeRate();
        if (exchangeRate == 0) revert ZeroExchangeRate();
        uint256 virtualLtReserve = (VIRTUAL_LIQUIDITY_USD * 1e18) / exchangeRate;

        IERC20(tokenAddr).forceApprove(address($.router), curveSupply);
        // Virtual tokenReserve = full totalSupply; only curveSupply (75%) actually transferred.
        // The launch-time `virtualLtReserve` is recoverable later as
        // `Pair.k() / Token.TOTAL_SUPPLY()`: `Pair.mint` sets `_pool.k =
        // tokenReserve * assetReserve = totalSupply * virtualLtReserve` once
        // and `Pair.swap` never modifies `_pool.k`. That identity is what
        // `_launchTimeVirtualLtReserve` exploits to derive donation-immune
        // raised-LT in `canGraduate` and `_prepareGraduationLiquidity`.
        $.router.addInitialLiquidity(tokenAddr, totalSupply, curveSupply, virtualLtReserve);
    }

    /// @notice Predict the clone address for `(creator_, name_, ticker_, userSalt)`
    ///         without deploying. Used by the frontend vanity miner — the
    ///         miner must call this with the exact `name`/`ticker` strings
    ///         that will appear in `LaunchParams`, otherwise `launch` will
    ///         revert with `NotVanityAddress` against a different mix.
    function predictTokenAddress(
        address creator_,
        string calldata name_,
        string calldata ticker_,
        bytes32 userSalt
    ) external view returns (address) {
        return Clones.predictDeterministicAddress(
            _s().tokenImplementation, _mixSalt(creator_, name_, ticker_, userSalt), address(this)
        );
    }

    /// @dev Bind the mined salt to the launch metadata so editing the name or
    ///      symbol after mining invalidates the salt. Strings are pre-hashed
    ///      to keep the on-chain mix (and the JS/assembly miner mirrors)
    ///      working in fixed-size 32-byte words.
    function _mixSalt(
        address creator_,
        string memory name_,
        string memory ticker_,
        bytes32 userSalt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator_, keccak256(bytes(name_)), keccak256(bytes(ticker_)), userSalt));
    }

    /// @dev Enforce the launch-time vanity invariant: the low
    ///      `VANITY_TRAILING_ZEROS * 4` bits of the address must all be
    ///      zero. ~3 gas per call — single bitwise AND.
    function _checkVanity(
        address tokenAddr
    ) internal pure {
        if (uint160(tokenAddr) & _VANITY_MASK != 0) {
            revert NotVanityAddress(tokenAddr);
        }
    }

    function _storeTokenInfo(
        address tokenAddr,
        address pair,
        LaunchParams calldata params,
        address creator_
    ) internal {
        _s().tokenInfo[tokenAddr] = TokenInfo({
            creator: creator_,
            pair: pair,
            ltAddress: params.ltAddress,
            name: params.name,
            ticker: params.ticker,
            description: params.description,
            image: params.image,
            urls: params.urls,
            lifecycle: Lifecycle.Curve
        });
    }

    // ─── Buy / Sell ──────────────────────────────────────────────────────

    /// @notice Buy tokens on the curve. Router-only.
    /// @param trader        Attributed in the emitted `Trade` event. Trusted
    ///                      because only allowlisted routers can reach here.
    /// @return tokensOut    Tokens delivered to the calling router.
    /// @return amountInUsed LT actually consumed (≤ amountIn).
    function buy(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        address trader
    ) external onlyRouter nonReentrant returns (uint256 tokensOut, uint256 amountInUsed) {
        TokenInfo storage info = _s().tokenInfo[tokenAddress];
        // `creator == 0` means the slot was never written. `Lifecycle.Curve` is
        // the zero value, so without this an unknown token would fall through
        // and revert deep in `router.buy` with an opaque error.
        if (info.creator == address(0)) revert TokenNotTrading();
        if (info.lifecycle == Lifecycle.Graduating) revert TokenIsGraduating();
        if (info.lifecycle != Lifecycle.Curve) revert TokenNotTrading();
        _enforceLaunchDelay(tokenAddress);

        (tokensOut, amountInUsed) = _executeBuy(msg.sender, trader, amountIn, tokenAddress);
        if (tokensOut < amountOutMin) revert SlippageExceeded();
    }

    /// @notice Sell tokens on the curve. Router-only.
    function sell(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        address trader
    ) external onlyRouter nonReentrant returns (uint256) {
        BondingStorage storage $ = _s();
        TokenInfo storage info = $.tokenInfo[tokenAddress];
        if (info.creator == address(0)) revert TokenNotTrading();
        if (info.lifecycle == Lifecycle.Graduating) revert TokenIsGraduating();
        if (info.lifecycle != Lifecycle.Curve) revert TokenNotTrading();

        (, uint256 assetOut) = $.router.sell(amountIn, tokenAddress, msg.sender);
        if (assetOut < amountOutMin) revert SlippageExceeded();

        (uint256 newCurveSupply, uint256 newLtReserve) = _getCurveState(tokenAddress);
        emit Trade(tokenAddress, trader, false, assetOut, amountIn, newCurveSupply, newLtReserve);
        return assetOut;
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function getTokenInfo(
        address token_
    ) external view returns (TokenInfo memory) {
        return _s().tokenInfo[token_];
    }

    /// @notice Hot-path lookup that avoids ABI-copying the dynamic strings in
    ///         `TokenInfo`. Prefer over `getTokenInfo` per-trade.
    function creatorOf(
        address token_
    ) external view returns (address) {
        return _s().tokenInfo[token_].creator;
    }

    /// @notice Hot-path lookup that avoids ABI-copying the dynamic strings in
    ///         `TokenInfo`. Prefer over `getTokenInfo` per-trade.
    function ltOf(
        address token_
    ) external view returns (address) {
        return _s().tokenInfo[token_].ltAddress;
    }

    function isTrading(
        address token_
    ) external view returns (bool) {
        TokenInfo storage info = _s().tokenInfo[token_];
        if (info.creator == address(0)) return false;
        return info.lifecycle == Lifecycle.Curve;
    }

    function isGraduating(
        address token_
    ) external view returns (bool) {
        TokenInfo storage info = _s().tokenInfo[token_];
        if (info.creator == address(0)) return false;
        return info.lifecycle == Lifecycle.Graduating;
    }

    function isGraduated(
        address token_
    ) external view returns (bool) {
        TokenInfo storage info = _s().tokenInfo[token_];
        if (info.creator == address(0)) return false;
        return info.lifecycle == Lifecycle.Graduated;
    }

    /// @notice Dual graduation triggers: USD (real LT raised × exchangeRate ≥
    ///         threshold) or supply (all curve tokens sold).
    /// @dev    USD trigger: uses STORED `assetReserve` minus the launch-time
    ///         virtual LT reserve (recovered as `Pair.k() / TOTAL_SUPPLY`,
    ///         see `_launchTimeVirtualLtReserve`). Donations to the pair
    ///         move only the live ERC20 balance, not the stored reserve, so
    ///         they are excluded from the threshold.
    ///
    ///         Supply trigger: uses live `IPair.tokenBalance()`. This IS an
    ///         `IERC20.balanceOf` read but is donation-resistant in the
    ///         opposite direction — token donations can only INCREASE the
    ///         balance, never satisfy "== 0", and the only path that drains
    ///         tokens out of the pair is the curve buy flow. Donated tokens
    ///         are unconditionally burned by `_prepareGraduationLiquidity`.
    function canGraduate(
        address token_
    ) public view returns (bool) {
        BondingStorage storage $ = _s();
        TokenInfo storage info = $.tokenInfo[token_];
        if (info.creator == address(0)) return false;
        if (info.lifecycle != Lifecycle.Curve) return false;

        address pair = info.pair;
        if (IPair(pair).tokenBalance() == 0) return true;

        (, uint256 assetReserve) = IPair(pair).getReserves();
        uint256 realLtRaised = assetReserve - _launchTimeVirtualLtReserve(token_, pair);
        uint256 valueUsd = (realLtRaised * IBounceLeveragedToken(info.ltAddress).exchangeRate()) / 1e18;
        return valueUsd >= $.graduationThresholdUsd;
    }

    function transferCreator(
        address tokenAddress,
        address newCreator
    ) external {
        if (newCreator == address(0)) revert ZeroAddress();
        TokenInfo storage info = _s().tokenInfo[tokenAddress];
        if (msg.sender != info.creator) revert NotCreator();
        if (newCreator == info.creator) revert InvalidInput();
        info.creator = newCreator;
        emit CreatorTransferred(tokenAddress, msg.sender, newCreator);
    }

    // ─── Public storage accessors (mirror pre-ERC-7201 ABI) ──────────────

    function factory() external view returns (Factory) {
        return _s().factory;
    }

    function router() external view returns (Router) {
        return _s().router;
    }

    function uniswapV2Factory() external view returns (address) {
        return _s().uniswapV2Factory;
    }

    function uniswapV2Router() external view returns (address) {
        return _s().uniswapV2Router;
    }

    function lpLock() external view returns (address) {
        return _s().lpLock;
    }

    function tokenImplementation() external view returns (address) {
        return _s().tokenImplementation;
    }

    function graduationThresholdUsd() external view returns (uint256) {
        return _s().graduationThresholdUsd;
    }

    function bounceGlobalStorage() external view returns (IBounceGlobalStorage) {
        return _s().bounceGlobalStorage;
    }

    function graduatedPair(
        address token_
    ) external view returns (address) {
        return _s().graduatedPair[token_];
    }

    /// @dev Replaces the auto-generated getter for the pre-ERC-7201 public
    ///      `pendingGraduation` mapping; needed because the storage now lives
    ///      inside the namespaced `BondingStorage` struct. Only consumed by
    ///      Solidity tests today — the off-chain stack (indexer, keeper, API,
    ///      web) keys off the `TokenGraduating` / `TokenGraduated` events.
    function pendingGraduation(
        address token_
    ) external view returns (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) {
        PendingGraduation storage p = _s().pendingGraduation[token_];
        return (p.tokensForLP, p.ltFromPair, p.lpBurned, p.unsoldBurned);
    }

    function launchBlock(
        address token_
    ) external view returns (uint64) {
        return _s().launchBlock[token_];
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    /// @notice Hot-swap BounceTech `GlobalStorage`. Backstop for the unlikely
    ///         case BounceTech redeploys it (factory rotations flow through
    ///         automatically). Affects future launches only.
    function setBounceGlobalStorage(
        address newBounceGlobalStorage
    ) external onlyOwner {
        if (newBounceGlobalStorage == address(0)) revert ZeroAddress();
        BondingStorage storage $ = _s();
        address old = address($.bounceGlobalStorage);
        $.bounceGlobalStorage = IBounceGlobalStorage(newBounceGlobalStorage);
        emit BounceGlobalStorageUpdated(old, newBounceGlobalStorage);
    }

    /// @notice Hot-swap the `Token` implementation cloned by future launches.
    ///         Existing clones bake their impl in at deploy time and are unaffected.
    /// @dev    Reverts unless the new impl exposes the same `TOTAL_SUPPLY`
    ///         as the current one. `_launchTimeVirtualLtReserve` recovers the
    ///         launch-time virtual LT reserve as `Pair.k() / TOTAL_SUPPLY`,
    ///         so a rotation that changes `TOTAL_SUPPLY` would mis-derive the
    ///         reserve for tokens launched before the rotation, breaking
    ///         their graduation math. Tokens launched AFTER a (mismatched)
    ///         rotation would still derive correctly because their `Pair.k`
    ///         is set off the new `TOTAL_SUPPLY`, but mixing pre- and post-
    ///         rotation tokens under a single derivation rule isn't safe.
    function setTokenImplementation(
        address newImpl
    ) external onlyOwner {
        if (newImpl == address(0)) revert ZeroAddress();
        BondingStorage storage $ = _s();
        if (Token(newImpl).TOTAL_SUPPLY() != Token($.tokenImplementation).TOTAL_SUPPLY()) {
            revert InvalidInput();
        }
        // Probe that the new impl can produce a vanity-suffixed clone. If
        // structurally broken, fail here rather than silently bricking every
        // user's `launch()`.
        VanityMining.mine(address(0x1), bytes32(0), bytes32(0), newImpl, address(this), 0);
        address old = $.tokenImplementation;
        $.tokenImplementation = newImpl;
        emit TokenImplementationUpdated(old, newImpl);
    }

    function addRouter(
        address router_
    ) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        if (!_s().routers.add(router_)) revert RouterAlreadyAdded();
        emit RouterAdded(router_);
    }

    function removeRouter(
        address router_
    ) external onlyOwner {
        EnumerableSet.AddressSet storage routers_ = _s().routers;
        if (!routers_.remove(router_)) revert RouterNotFound();
        if (routers_.length() == 0) revert MustKeepOneRouter();
        emit RouterRemoved(router_);
    }

    function isRouter(
        address router_
    ) external view returns (bool) {
        return _s().routers.contains(router_);
    }

    function getRouters() external view returns (address[] memory) {
        return _s().routers.values();
    }

    /// @notice Owner sweep for LT dust accumulated in this contract from the
    ///         hostile-pre-seed rebalance path in `_routerDepositAndDispose`.
    ///         For honest graduations this is a no-op (no LT ever lands in
    ///         `Bonding`). For tokens whose graduation tripped a mint-style
    ///         pre-seed attack, the off-ratio LT remainder accumulates here
    ///         as protocol revenue and is sweepable to `to` (typically the
    ///         protocol's `FeeVault`, which has `sweepDonations()` for this
    ///         exact pattern).
    /// @dev    Bonding never holds LT in normal operation: curve trading
    ///         routes LT through `Pair`/`Router`, and graduation moves
    ///         raised LT directly from the curve `Pair` to the HyperSwap
    ///         `Pair` inside `_seedUniswapV2Direct`. Anything sitting in
    ///         this contract's LT balance is therefore rebalance dust or
    ///         a mistaken transfer — both safe to sweep. Owner already has
    ///         UUPS-upgrade authority, so an open ERC20 sweep doesn't
    ///         meaningfully expand the trust surface.
    function rescueLT(
        address ltToken,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (to == address(0) || ltToken == address(0)) revert ZeroAddress();
        IERC20(ltToken).safeTransfer(to, amount);
        emit LTRescued(ltToken, to, amount);
    }

    // ─── Internals ───────────────────────────────────────────────────────

    /// @dev Anti-snipe gate. Inside the launch tx the seed buy fires the
    ///      transient bypass set in `launch()`, so the creator's seed always
    ///      lands. Any other buy (including same-block sniper bundles in a
    ///      separate tx) sees a cleared transient slot and reverts until
    ///      `block.number > launchBlock + LAUNCH_TRADING_DELAY_BLOCKS`. The
    ///      bypass is consumed on first use so a malicious router that
    ///      crammed multiple buys into one tx still only gets one through.
    ///
    ///      We do **not** cap the seed-buy size. Some creators legitimately
    ///      seed >50% of a curve and burn the result post-launch as a supply
    ///      sink — capping would block that pattern, and the cap is
    ///      trivially bypassable anyway via a second wallet at
    ///      `launchBlock + LAUNCH_TRADING_DELAY_BLOCKS + 1`. See root
    ///      `AGENTS.md` for the threat-model writeup. Auditors: this is
    ///      intentional, not an oversight.
    function _enforceLaunchDelay(
        address tokenAddress
    ) internal {
        if (block.number > uint256(_s().launchBlock[tokenAddress]) + LAUNCH_TRADING_DELAY_BLOCKS) {
            return;
        }
        bytes32 slot = _SEED_BUY_BYPASS_SLOT;
        address bypass;
        assembly {
            bypass := tload(slot)
        }
        if (bypass != tokenAddress) revert TradingNotOpen();
        assembly {
            tstore(slot, 0)
        }
    }

    /// @dev `tokenHolder` is where `Router` pulls LT from / delivers tokens to
    ///      (the calling Zap). `trader` is event-only attribution (the user EOA).
    function _executeBuy(
        address tokenHolder,
        address trader,
        uint256 amountIn,
        address tokenAddress
    ) internal returns (uint256 tokensOut, uint256 amountInUsed) {
        (amountInUsed, tokensOut) = _s().router.buy(amountIn, tokenAddress, tokenHolder);

        (uint256 newCurveSupply, uint256 newLtReserve) = _getCurveState(tokenAddress);
        emit Trade(tokenAddress, trader, true, amountInUsed, tokensOut, newCurveSupply, newLtReserve);

        if (canGraduate(tokenAddress)) {
            _enterGraduating(tokenAddress);
        }
    }

    /// @dev Phase 1: drain curve, cache LP-bound amounts, freeze trading. Runs
    ///      inline at end of the threshold-crossing buy. Pinning `tokensForLP`
    ///      and `ltFromPair` here (at the last curve price) is what preserves
    ///      the zero-gap invariant across the tx split.
    function _enterGraduating(
        address tokenAddress
    ) internal {
        BondingStorage storage $ = _s();
        TokenInfo storage info = $.tokenInfo[tokenAddress];
        info.lifecycle = Lifecycle.Graduating;

        (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) =
            _prepareGraduationLiquidity(tokenAddress);

        $.pendingGraduation[tokenAddress] = PendingGraduation({
            tokensForLP: tokensForLP, ltFromPair: ltFromPair, lpBurned: lpBurned, unsoldBurned: unsoldBurned
        });

        emit TokenGraduating(tokenAddress, tokensForLP, ltFromPair, lpBurned, unsoldBurned);
    }

    /// @notice Phase 2: seed the V2 LP and lock it. Permissionless —
    ///         keeper drives the happy path; anyone can rescue a stuck token.
    /// @dev Bypasses the V2 router and calls `pair.mint(lpLock)`
    ///      directly. This is brick-proof against a front-runner pre-creating
    ///      the pair and dust-seeding it between phases.
    /// @dev Exchange-rate drift between phase 1 and phase 2 is accepted by
    ///      design (issue #309, audit findings F-07 / IN-03). The cached
    ///      `(tokensForLP, ltFromPair)` are pure pair-state arithmetic — see
    ///      `_prepareGraduationLiquidity`, which never reads `exchangeRate()`
    ///      — so the LP opens at the exact LT-per-token ratio the curve
    ///      closed at, regardless of how long phase 2 takes. What drifts is
    ///      only the USD denomination of the LT side, which is inherent to
    ///      using a leveraged token as the curve reserve: holders accept that
    ///      exposure when they buy in. A keeper Worker drives finalize within
    ///      ~60s of `TokenGraduating`, so the practical drift window is
    ///      single-digit seconds. We deliberately do NOT add a freshness
    ///      timestamp / staleness gate here: the audit-recommended recompute
    ///      path would return byte-identical values (its inputs are frozen
    ///      while `Lifecycle.Graduating`), and re-pricing the LP at the live
    ///      `exchangeRate()` would break the zero-gap-in-LT-units invariant
    ///      enforced by `test/GraduationInvariants.t.sol`.
    function finalizeGraduation(
        address tokenAddress
    ) external nonReentrant {
        BondingStorage storage $ = _s();
        TokenInfo storage info = $.tokenInfo[tokenAddress];
        if (info.lifecycle != Lifecycle.Graduating) revert NotGraduating();

        address lt = info.ltAddress;
        PendingGraduation memory p = $.pendingGraduation[tokenAddress];

        address lpPair = _ensureUniswapV2Pair(tokenAddress, lt);
        uint256 liquidity = _seedUniswapV2Direct(tokenAddress, lt, lpPair, p.tokensForLP, p.ltFromPair);

        info.lifecycle = Lifecycle.Graduated;
        $.graduatedPair[tokenAddress] = lpPair;
        delete $.pendingGraduation[tokenAddress];

        LPLock($.lpLock).recordLock(tokenAddress, lpPair, liquidity);

        emit TokenGraduated(tokenAddress, lpPair, liquidity, p.tokensForLP, p.lpBurned, p.unsoldBurned);
    }

    /// @dev Burns unsold curve tokens, drains real raised LT, computes
    ///      `tokensForLP` for zero-gap LP seeding, burns the LP excess.
    ///
    ///      Price equality: `tokensForLP / ltFromPair = tokenReserve / assetReserve`,
    ///      with `ltFromPair = assetReserve - virtualLtReserve` (the LT
    ///      actually raised by the curve, excluding the launch-time virtual
    ///      seed; the seed is recovered as `Pair.k() / TOTAL_SUPPLY`, see
    ///      `_launchTimeVirtualLtReserve`). Substituting gives LP price =
    ///      `assetReserve / tokenReserve` = curve close marginal price.
    ///      Donations of LT directly to the pair don't move the stored
    ///      `assetReserve`, so they're excluded from `ltFromPair`.
    ///
    ///      Token-side donations are handled by `unsoldBurned`: any tokens
    ///      sitting in the pair beyond the curve's accounting are burned.
    ///
    ///      With virtual `tokenReserve = totalSupply` and `curveSupply = 75%`,
    ///      the parabola `tokensForLP(sold) = sold·(S−sold)/S` peaks at
    ///      `S/4 = LP_RESERVE` when `sold = S/2`, so `tokensForLP ≤ LP_RESERVE`
    ///      is mathematically invariant. The cap is defensive.
    function _prepareGraduationLiquidity(
        address tokenAddress
    ) internal returns (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) {
        address pairAddr = _s().tokenInfo[tokenAddress].pair;
        (uint256 tokenReserve, uint256 assetReserve) = IPair(pairAddr).getReserves();

        unsoldBurned = IERC20(tokenAddress).balanceOf(pairAddr);
        if (unsoldBurned > 0) {
            Token(tokenAddress).burn(pairAddr, unsoldBurned);
        }

        ltFromPair = assetReserve - _launchTimeVirtualLtReserve(tokenAddress, pairAddr);
        if (ltFromPair > 0) {
            _s().router.graduate(tokenAddress, ltFromPair);
        }

        tokensForLP = assetReserve == 0 ? 0 : (ltFromPair * tokenReserve) / assetReserve;
        if (tokensForLP > LP_RESERVE) tokensForLP = LP_RESERVE;

        lpBurned = LP_RESERVE - tokensForLP;
        if (lpBurned > 0) {
            Token(tokenAddress).burn(address(this), lpBurned);
        }
    }

    /// @dev Recovers the launch-time virtual LT reserve from immutable
    ///      identities: `Pair._pool.k = tokenReserve_init * assetReserve_init
    ///      = TOTAL_SUPPLY * virtualLtReserve_init` is set ONCE in
    ///      `Pair.mint` and never modified by `Pair.swap` (swap only
    ///      mutates `tokenReserve` / `assetReserve` and asserts K-floor).
    ///      So `Pair.k() / Token.TOTAL_SUPPLY()` returns the exact
    ///      `virtualLtReserve` that was passed to `addInitialLiquidity` at
    ///      launch — for any pair, in any phase, with no storage of our own.
    ///
    ///      Going through this derivation rather than a stored mirror
    ///      eliminates an admin-writable economic-state slot and makes the
    ///      donation-immunity property a pure consequence of the pair's
    ///      already-immutable accounting. The `TOTAL_SUPPLY`-equality check
    ///      in `setTokenImplementation` keeps the divisor consistent across
    ///      impl rotations, so tokens launched under different
    ///      `tokenImplementation` versions still derive the same way.
    function _launchTimeVirtualLtReserve(
        address token_,
        address pair_
    ) internal view returns (uint256) {
        return IPair(pair_).k() / Token(token_).TOTAL_SUPPLY();
    }

    function _ensureUniswapV2Pair(
        address tokenA,
        address tokenB
    ) internal returns (address pair) {
        IUniswapV2Factory v2Factory = IUniswapV2Factory(_s().uniswapV2Factory);
        pair = v2Factory.getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = v2Factory.createPair(tokenA, tokenB);
        }
    }

    /// @dev LP-seeding into the HyperSwap pair, with hostile-pre-seed defense
    ///      (#308). Three regimes:
    ///
    ///        1. **Empty pair (~99% of graduations).** Pristine direct mint
    ///           at exactly `(tokensForLP, ltFromPair)` — pool opens at the
    ///           curve-close price. Zero gap by construction.
    ///        2. **Pure-donation pre-seed.** Attacker `transfer`'d to the
    ///           pair without `mint` (balance > 0, reserves == 0).
    ///           `pair.skim(lpLock)` sweeps the donation back to the
    ///           protocol; path then collapses to (1).
    ///        3. **Mint pre-seed (the actual issue).** Attacker called
    ///           `pair.mint` against a self-funded dust seed, baking a
    ///           hostile (TOKEN, LT) ratio into the pool. Without
    ///           intervention `pair.mint(lpLock)`'s `min(amount0·S/r0,
    ///           amount1·S/r1)` formula would (a) open the LP off
    ///           curve-close-price and (b) donate the larger arm to the
    ///           attacker's pre-existing LP. We rebalance via a direct
    ///           `pair.swap` toward the curve-close ratio, then deposit
    ///           the remaining inventory via the router's `quote()`-based
    ///           `addLiquidity` — which only pulls the optimal amounts
    ///           at the post-swap ratio, so neither side becomes a
    ///           `min()` donation. Off-ratio TOKEN remainder is burned;
    ///           off-ratio LT remainder accumulates here for owner sweep
    ///           via `rescueLT`.
    ///
    ///      Brick resistance: the rebalance swap input is capped at our
    ///      per-side budget; the swap is precondition-checked to skip
    ///      when V2's fee-charging `getAmountOut` would round to zero
    ///      (which would otherwise revert `pair.swap` with
    ///      `INSUFFICIENT_OUTPUT_AMOUNT`); the deposit uses
    ///      `addLiquidity(min=1, min=1)`; and the empty/donation regimes
    ///      don't touch the router or `pair.swap`. So a hostile pre-seed
    ///      of any shape cannot DoS `finalizeGraduation`.
    ///
    ///      Asymmetric router usage: **the rebalance swap is direct-to-pair
    ///      (`pair.swap`), not router-mediated.** HyperSwap mainnet's V2
    ///      router replaces every canonical swap function with FoT-only
    ///      variants that take a non-standard `referrer` argument
    ///      (selectors `ac3893ba` / `b4822be3` / `52aa4c22` — see
    ///      `packages/contracts/AGENTS.md` "HyperSwap Router non-standard
    ///      ABI"). `Zap._swapOnUniswapV2` already uses `pair.swap` for the
    ///      same reason; matching the pattern keeps both in sync and
    ///      removes a HyperSwap-specific footgun. The deposit leg DOES
    ///      use `router.addLiquidity` because that function IS canonical
    ///      V2 on HyperSwap (verified selector `e8e33700`) and the
    ///      router's `quote()`-based optimal-split logic is non-trivial
    ///      to safely reimplement.
    ///
    ///      Phase 1 is unchanged (the rebalance fires only in phase 2
    ///      when reserves are non-zero), so the small-block gas budget
    ///      is preserved.
    function _seedUniswapV2Direct(
        address tokenAddress,
        address lt,
        address pair,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) internal returns (uint256 liquidity) {
        // Regime 2 — sweep any donation pre-seed back to the protocol so it
        // doesn't pollute the post-swap ratio. No-op on a freshly-created
        // pair (balance == reserves == 0).
        IUniswapV2Pair(pair).skim(_s().lpLock);

        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        // Regime 1 — pristine pair, direct mint at exact curve-close ratio.
        if (r0 == 0 && r1 == 0) {
            IERC20(tokenAddress).safeTransfer(pair, tokensForLP);
            IERC20(lt).safeTransfer(pair, ltFromPair);
            return IUniswapV2Pair(pair).mint(_s().lpLock);
        }

        // Regime 3 — mint pre-seed: rebalance, then deposit balanced subset.
        // `lpLock_` re-read from storage inside `_routerDepositAndDispose`.
        // Reserves and token-ordering re-read inside `_seedRebalancing` to
        // keep this function's stack pressure under solc's 16-slot ceiling
        // without `viaIR`.
        return _seedRebalancing(tokenAddress, lt, pair, tokensForLP, ltFromPair);
    }

    /// @dev Memory bag for `_seedRebalancing` → `_pairRebalance` so the call
    ///      doesn't blow stack-too-deep (8 → 8 args wouldn't fit otherwise
    ///      under solc's no-viaIR codegen).
    struct RebalanceParams {
        address pair;
        address tokenIn;
        bool tokenInIs0;
        uint256 reserveIn;
        uint256 reserveOut;
        uint256 targetN;
        uint256 targetD;
        uint256 maxSwap;
    }

    /// @dev Hostile-mint-pre-seed branch of `_seedUniswapV2Direct`. Split
    ///      out because (a) it's the cold path (~99% of graduations hit
    ///      the empty-pair branch above) and (b) the local-variable density
    ///      would otherwise blow stack-too-deep.
    function _seedRebalancing(
        address tokenAddress,
        address lt,
        address pair,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) internal returns (uint256 liquidity) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        bool tokenIs0 = IUniswapV2Pair(pair).token0() == tokenAddress;
        (uint256 reserveToken, uint256 reserveLT) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        // Direction: pool TOKEN-rich vs target ⇒ swap LT in (TOKEN out).
        // Pool LT-rich ⇒ swap TOKEN in (LT out). Bounded by uint112 reserves
        // and curve-close-shape targets, both products fit in uint256.
        if (reserveToken * ltFromPair > reserveLT * tokensForLP) {
            // Pool TOKEN-rich. tokenIn = lt, tokenOut = tokenAddress.
            // tokenInIs0 = (lt is token0) = !tokenIs0.
            _pairRebalance(
                RebalanceParams({
                    pair: pair,
                    tokenIn: lt,
                    tokenInIs0: !tokenIs0,
                    reserveIn: reserveLT,
                    reserveOut: reserveToken,
                    targetN: ltFromPair,
                    targetD: tokensForLP,
                    maxSwap: _swapBudget(ltFromPair)
                })
            );
        } else if (reserveToken * ltFromPair < reserveLT * tokensForLP) {
            // Pool LT-rich. tokenIn = tokenAddress, tokenInIs0 = tokenIs0.
            _pairRebalance(
                RebalanceParams({
                    pair: pair,
                    tokenIn: tokenAddress,
                    tokenInIs0: tokenIs0,
                    reserveIn: reserveToken,
                    reserveOut: reserveLT,
                    targetN: tokensForLP,
                    targetD: ltFromPair,
                    maxSwap: _swapBudget(tokensForLP)
                })
            );
        }
        // else: pool already at curve-close ratio (rare — e.g. attacker
        // pre-seeded at exactly target). Skip swap, deposit directly.

        return _routerDepositAndDispose(tokenAddress, lt);
    }

    /// @dev Cap the rebalance swap at 99% of the available side's budget,
    ///      so the subsequent `addLiquidity` always has a non-zero amount
    ///      of BOTH sides to deposit. Without this, an extreme hostile
    ///      pre-seed (massively imbalanced reserves) drives the
    ///      unconstrained `_noFeeSwapInput` past our per-side budget,
    ///      `_pairRebalance` clamps to the full budget, and the swap
    ///      consumes 100% of one side. `_routerDepositAndDispose` then
    ///      skips `addLiquidity` (`remToken == 0` or `remLT == 0`),
    ///      `finalizeGraduation` returns `liquidity = 0`, and
    ///      `LPLock.recordLock(...)` records a zero-sized lock — the
    ///      attacker's pre-existing LP becomes 100% of the pool. Reserving
    ///      1% guarantees the deposit leg always lands AND mints non-zero
    ///      LP at the post-swap ratio. The 1% comes off the swap, not the
    ///      deposit — for any realistic pre-seed `s_unconstrained` is
    ///      orders of magnitude below `maxSwap`, so the cap doesn't bind
    ///      and behaviour is unchanged. It only kicks in for catastrophic
    ///      pre-seeds beyond our budget capacity, where the alternative
    ///      is bricking. See `test_catastrophicPreSeed_capPreservesNonZeroLpLock`
    ///      in `test/HostilePreSeed.t.sol`.
    function _swapBudget(
        uint256 budget
    ) internal pure returns (uint256) {
        return (budget * 99) / 100;
    }

    /// @dev Rebalance leg: compute no-fee swap input, cap at budget,
    ///      execute via direct `pair.swap`. Bypasses the V2 router because
    ///      HyperSwap mainnet's router has no canonical
    ///      `swapExactTokensForTokens` — only FoT-with-`referrer` variants
    ///      with a non-standard ABI (see
    ///      `packages/contracts/AGENTS.md`). Same direct-to-pair pattern
    ///      `Zap._swapOnUniswapV2` uses for the same reason.
    ///
    ///      We compute the V2 fee-charging amount-out ourselves
    ///      (`(s · 997 · rOut) / (rIn · 1000 + s · 997)`) and pass it as
    ///      the output to `pair.swap`. The pair's K-invariant check uses
    ///      the canonical V2 0.3% fee math, so a wrong `expectedOut`
    ///      would revert there.
    ///
    ///      The `expectedOut == 0` precheck is necessary because
    ///      `pair.swap` reverts with `INSUFFICIENT_OUTPUT_AMOUNT` when
    ///      both output amounts are zero — happens for tiny `s` against
    ///      an extremely imbalanced pool. Skipping is safe — the
    ///      subsequent `addLiquidity` still defuses the LP-capture
    ///      attack via its `quote()`-based optimal split, just opens at
    ///      the (sub-bp) residual skew the swap would have closed.
    ///      Whether the skip fired is observable post-hoc by comparing
    ///      the cached `tokensForLP / ltFromPair` ratio in the
    ///      `TokenGraduating` event against the resulting pool reserves.
    ///
    ///      No router approval needed (we transfer to the pair directly),
    ///      so no allowance hygiene to worry about.
    function _pairRebalance(
        RebalanceParams memory p
    ) internal {
        uint256 s = _noFeeSwapInput(p.reserveIn, p.reserveOut, p.targetN, p.targetD, p.maxSwap);
        if (s == 0) return;

        uint256 amountInWithFee = s * 997;
        uint256 expectedOut = (amountInWithFee * p.reserveOut) / (p.reserveIn * 1000 + amountInWithFee);
        if (expectedOut == 0) return;

        IERC20(p.tokenIn).safeTransfer(p.pair, s);
        (uint256 amount0Out, uint256 amount1Out) = p.tokenInIs0 ? (uint256(0), expectedOut) : (expectedOut, uint256(0));
        IUniswapV2Pair(p.pair).swap(amount0Out, amount1Out, address(this), new bytes(0));
    }

    /// @dev Deposit leg: add liquidity at the post-swap pool ratio via the
    ///      router. The router's `quote()`-based balanced split only pulls
    ///      the optimal amounts (no `min()` donation); off-ratio remainder
    ///      stays in this contract and is disposed: TOKEN burned, LT held
    ///      for `rescueLT`.
    ///
    ///      `min0=1, min1=1` is intentional. Slippage protection on
    ///      `addLiquidity` exists to defend against a third party moving
    ///      the pool ratio between quote and execution; here we just set
    ///      the ratio ourselves in `_pairRebalance` in the same atomic
    ///      tx, so there's no third party to defend against. The `=1`
    ///      (rather than `=0`) trips V2 router's degenerate-ratio guard
    ///      so the call can't silently land at near-zero.
    ///
    ///      Approvals are reset to zero after `addLiquidity` returns.
    ///      The router only pulls the matched-ratio subset, so unconsumed
    ///      desired amounts leave a residual allowance — clearing it
    ///      keeps the no-dangling-allowance invariant tidy.
    function _routerDepositAndDispose(
        address tokenAddress,
        address lt
    ) internal returns (uint256 liquidity) {
        BondingStorage storage $ = _s();
        address routerAddr = $.uniswapV2Router;
        address lpLock_ = $.lpLock;
        uint256 remToken = IERC20(tokenAddress).balanceOf(address(this));
        uint256 remLT = IERC20(lt).balanceOf(address(this));

        if (remToken > 0 && remLT > 0) {
            IERC20(tokenAddress).forceApprove(routerAddr, remToken);
            IERC20(lt).forceApprove(routerAddr, remLT);
            (,, liquidity) = IUniswapV2Router02(routerAddr)
                .addLiquidity(tokenAddress, lt, remToken, remLT, 1, 1, lpLock_, block.timestamp);
            IERC20(tokenAddress).forceApprove(routerAddr, 0);
            IERC20(lt).forceApprove(routerAddr, 0);
        }

        // Burn off-ratio TOKEN remainder (`Bonding` is the Token owner).
        // Hostile pre-seeds reduce circulating supply by the attacker's
        // wasted-side share, net positive for honest holders.
        uint256 leftoverToken = IERC20(tokenAddress).balanceOf(address(this));
        if (leftoverToken > 0) {
            Token(tokenAddress).burn(address(this), leftoverToken);
        }
        // LT remainder is third-party — we cannot burn it. It stays in this
        // contract for the owner to sweep via `rescueLT`. Honest graduations
        // never reach this code path, so this is zero outside attack scenarios.
    }

    /// @dev Smallest swap input that drives the pool's reserve ratio
    ///      `(reserveIn + s) / (reserveOut - out)` to `targetN/targetD`
    ///      under the no-fee constant-product model:
    ///        `(reserveIn + s)² = reserveIn * reserveOut * targetN/targetD`
    ///      ⇒ `s = sqrt(reserveIn * reserveOut * targetN/targetD) - reserveIn`,
    ///      capped at `maxSwap`. The actual swap is fee-charging (V2 0.3%),
    ///      so the post-swap ratio drifts ~30 bps from the target; the
    ///      balanced-subset deposit absorbs the residual without donating.
    ///
    ///      `Math.mulDiv` keeps the intermediate product
    ///      `reserveIn * reserveOut * targetN` inside its 512-bit working
    ///      space, but the final result `... / targetD` must still fit in
    ///      uint256. Call sites must keep that invariant — in practice
    ///      both the V2 uint112 reserve cap and the bound that
    ///      `tokensForLP` ≤ `LP_RESERVE` and `ltFromPair` ≤ raised LT
    ///      are well inside the safe envelope. Constructed adversarial
    ///      inputs that violate this would `revert` rather than silently
    ///      truncate, which is the correct failure mode.
    function _noFeeSwapInput(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 targetN,
        uint256 targetD,
        uint256 maxSwap
    ) internal pure returns (uint256) {
        if (reserveIn == 0 || reserveOut == 0 || targetN == 0 || targetD == 0 || maxSwap == 0) {
            return 0;
        }
        uint256 product = Math.mulDiv(reserveIn * reserveOut, targetN, targetD);
        uint256 newIn = Math.sqrt(product);
        if (newIn <= reserveIn) return 0;
        uint256 s = newIn - reserveIn;
        return s > maxSwap ? maxSwap : s;
    }

    function _getCurveState(
        address tokenAddress
    ) internal view returns (uint256 curveSupply, uint256 ltReserve) {
        address pair = _s().tokenInfo[tokenAddress].pair;
        (curveSupply, ltReserve) = IPair(pair).getReserves();
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
