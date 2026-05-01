// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Factory} from "./Factory.sol";
import {Router} from "./Router.sol";
import {Token} from "./Token.sol";
import {IBounceFactory} from "./interfaces/IBounceFactory.sol";
import {IBounceGlobalStorage} from "./interfaces/IBounceGlobalStorage.sol";
import {IBounceLeveragedToken} from "./interfaces/IBounceLeveragedToken.sol";
import {IPair} from "./interfaces/IPair.sol";
import {IUniswapV2Factory} from "./interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "./interfaces/IUniswapV2Pair.sol";
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
contract Bonding is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    Factory public factory;
    Router public router;

    address public hyperswapFactory;
    address public lpLock;

    /// @dev EIP-1167 implementation cloned by `launch()`. Hot-swappable for
    ///      future launches via `setTokenImplementation`; already-deployed
    ///      clones bake in the impl address at deploy time and are unaffected.
    address public tokenImplementation;

    /// @dev Authorised routers (Zaps). Set-based so a new Zap can be
    ///      allowlisted before the old one is removed, giving zero-downtime
    ///      router rotations.
    EnumerableSet.AddressSet private _routers;

    /// @dev Target virtual LT reserve, 18-dp USD. Since virtual tokenReserve =
    ///      totalSupply (1B), opening MC == this value.
    uint256 public constant VIRTUAL_LIQUIDITY_USD = 100 ether;

    /// @dev Graduation fires when real LT reserve × exchangeRate ≥ this. Set
    ///      once at `initialize` and immutable thereafter: a live setter would
    ///      let an MEV searcher sandwich the parameter change against every
    ///      currently-trading token (issue #269). Tuning requires a UUPS
    ///      upgrade with a `reinitializer`.
    uint256 public graduationThresholdUsd;

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
    struct PendingGraduation {
        uint256 tokensForLP;
        uint256 ltFromPair;
        uint256 lpBurned;
        uint256 unsoldBurned;
        uint64 pendingSince;
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

    mapping(address => TokenInfo) internal _tokenInfo;

    mapping(address => address) public graduatedPair;
    mapping(address => PendingGraduation) public pendingGraduation;

    /// @dev BounceTech `GlobalStorage`, queried per-launch to resolve the live
    ///      `Factory` and reject non-BounceTech LTs (which could otherwise
    ///      siphon buyer USDC inside `mint`). Going through `GlobalStorage`
    ///      means BounceTech `setFactory` rotations flow through automatically.
    IBounceGlobalStorage public bounceGlobalStorage;

    /// @dev Storage gap → 50 slots total. Append new state variables before
    ///      this gap and shrink the length to match.
    uint256[38] private __gap;

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
    ///         now callable to seed the HyperSwap LP.
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
    event HyperswapUpdated(address indexed hyperswapFactory, address indexed lpLock);
    event BounceGlobalStorageUpdated(address indexed oldGlobalStorage, address indexed newGlobalStorage);

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
    /// @dev New `lpLock` hasn't allowlisted this Bonding as a locker.
    ///      `setHyperswap` would otherwise brick every in-flight graduation.
    error LpLockNotConfigured();
    error NotVanityAddress(address tokenAddr);
    /// @dev `ltAddress` not in the BounceTech `Factory.ltExists` mapping
    ///      (arbitrary contract, or an LT BounceTech has since `redeployLt`'d).
    error UnknownLeveragedToken(address ltAddress);

    modifier onlyRouter() {
        if (!_routers.contains(msg.sender)) revert NotRouter();
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
        address hyperswapFactory_,
        address lpLock_,
        address tokenImplementation_,
        uint256 graduationThresholdUsd_,
        address bounceGlobalStorage_
    ) external initializer {
        if (
            factory_ == address(0) || router_ == address(0) || hyperswapFactory_ == address(0) || lpLock_ == address(0)
                || tokenImplementation_ == address(0) || bounceGlobalStorage_ == address(0)
        ) revert ZeroAddress();
        if (graduationThresholdUsd_ < VIRTUAL_LIQUIDITY_USD) revert InvalidInput();
        __Ownable_init(msg.sender);

        factory = Factory(factory_);
        router = Router(router_);
        hyperswapFactory = hyperswapFactory_;
        lpLock = lpLock_;
        tokenImplementation = tokenImplementation_;
        graduationThresholdUsd = graduationThresholdUsd_;
        bounceGlobalStorage = IBounceGlobalStorage(bounceGlobalStorage_);
    }

    /// @notice Backfill `bounceGlobalStorage` on a proxy deployed before this
    ///         slot existed. Invoked atomically via `upgradeToAndCall`. The
    ///         `address(0)` guard closes the reinitializer-front-run window on
    ///         fresh proxies that haven't been initialised yet.
    function initializeBounceGlobalStorage(
        address bounceGlobalStorage_
    ) external reinitializer(2) {
        if (bounceGlobalStorage_ == address(0)) revert ZeroAddress();
        if (address(bounceGlobalStorage) != address(0)) revert InvalidInput();
        bounceGlobalStorage = IBounceGlobalStorage(bounceGlobalStorage_);
        emit BounceGlobalStorageUpdated(address(0), bounceGlobalStorage_);
    }

    // ─── Launch ──────────────────────────────────────────────────────────

    function launch(
        LaunchParams calldata params,
        address creator_
    ) external onlyRouter nonReentrant returns (address tokenAddr, address pair) {
        if (params.ltAddress == address(0)) revert InvalidInput();
        // `Zap.createToken` is permissionless; without this gate a fake LT
        // could siphon USDC inside `mint` (which `Zap` `forceApprove`s).
        if (!IBounceFactory(bounceGlobalStorage.factory()).ltExists(params.ltAddress)) {
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
        tokenAddr = Clones.predictDeterministicAddress(tokenImplementation, saltMixed, address(this));
        _checkVanity(tokenAddr);

        _storeTokenInfo(tokenAddr, address(0), params, creator_);

        pair = _deployAndSeed(tokenAddr, saltMixed, params.name, params.ticker, params.ltAddress);
        _tokenInfo[tokenAddr].pair = pair;

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
        Clones.cloneDeterministic(tokenImplementation, saltMixed);

        Token(tokenAddr).initialize(name_, ticker_, address(this));

        uint256 totalSupply = Token(tokenAddr).TOTAL_SUPPLY();
        uint256 curveSupply = (totalSupply * CURVE_BPS) / BPS_DENOM;

        pair = factory.createPair(tokenAddr, ltAddress);

        uint256 exchangeRate = IBounceLeveragedToken(ltAddress).exchangeRate();
        if (exchangeRate == 0) revert ZeroExchangeRate();
        uint256 virtualLtReserve = (VIRTUAL_LIQUIDITY_USD * 1e18) / exchangeRate;

        IERC20(tokenAddr).forceApprove(address(router), curveSupply);
        // Virtual tokenReserve = full totalSupply; only curveSupply (75%) actually transferred.
        router.addInitialLiquidity(tokenAddr, totalSupply, curveSupply, virtualLtReserve);
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
            tokenImplementation, _mixSalt(creator_, name_, ticker_, userSalt), address(this)
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
        _tokenInfo[tokenAddr] = TokenInfo({
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
        TokenInfo storage info = _tokenInfo[tokenAddress];
        // `creator == 0` means the slot was never written. `Lifecycle.Curve` is
        // the zero value, so without this an unknown token would fall through
        // and revert deep in `router.buy` with an opaque error.
        if (info.creator == address(0)) revert TokenNotTrading();
        if (info.lifecycle == Lifecycle.Graduating) revert TokenIsGraduating();
        if (info.lifecycle != Lifecycle.Curve) revert TokenNotTrading();

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
        TokenInfo storage info = _tokenInfo[tokenAddress];
        if (info.creator == address(0)) revert TokenNotTrading();
        if (info.lifecycle == Lifecycle.Graduating) revert TokenIsGraduating();
        if (info.lifecycle != Lifecycle.Curve) revert TokenNotTrading();

        (, uint256 assetOut) = router.sell(amountIn, tokenAddress, msg.sender);
        if (assetOut < amountOutMin) revert SlippageExceeded();

        (uint256 newCurveSupply, uint256 newLtReserve) = _getCurveState(tokenAddress);
        emit Trade(tokenAddress, trader, false, assetOut, amountIn, newCurveSupply, newLtReserve);
        return assetOut;
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function getTokenInfo(
        address token_
    ) external view returns (TokenInfo memory) {
        return _tokenInfo[token_];
    }

    /// @notice Hot-path lookup that avoids ABI-copying the dynamic strings in
    ///         `TokenInfo`. Prefer over `getTokenInfo` per-trade.
    function creatorOf(
        address token_
    ) external view returns (address) {
        return _tokenInfo[token_].creator;
    }

    /// @notice Hot-path lookup that avoids ABI-copying the dynamic strings in
    ///         `TokenInfo`. Prefer over `getTokenInfo` per-trade.
    function ltOf(
        address token_
    ) external view returns (address) {
        return _tokenInfo[token_].ltAddress;
    }

    function isTrading(
        address token_
    ) external view returns (bool) {
        TokenInfo storage info = _tokenInfo[token_];
        if (info.creator == address(0)) return false;
        return info.lifecycle == Lifecycle.Curve;
    }

    function isGraduating(
        address token_
    ) external view returns (bool) {
        TokenInfo storage info = _tokenInfo[token_];
        if (info.creator == address(0)) return false;
        return info.lifecycle == Lifecycle.Graduating;
    }

    function isGraduated(
        address token_
    ) external view returns (bool) {
        TokenInfo storage info = _tokenInfo[token_];
        if (info.creator == address(0)) return false;
        return info.lifecycle == Lifecycle.Graduated;
    }

    /// @notice Dual graduation triggers: USD (LT reserve × exchangeRate ≥
    ///         threshold) or supply (all curve tokens sold).
    function canGraduate(
        address token_
    ) public view returns (bool) {
        TokenInfo storage info = _tokenInfo[token_];
        if (info.creator == address(0)) return false;
        if (info.lifecycle != Lifecycle.Curve) return false;

        address pair = info.pair;
        if (IPair(pair).tokenBalance() == 0) return true;

        uint256 valueUsd = (IPair(pair).assetBalance() * IBounceLeveragedToken(info.ltAddress).exchangeRate()) / 1e18;
        return valueUsd >= graduationThresholdUsd;
    }

    function transferCreator(
        address tokenAddress,
        address newCreator
    ) external {
        if (newCreator == address(0)) revert ZeroAddress();
        TokenInfo storage info = _tokenInfo[tokenAddress];
        if (msg.sender != info.creator) revert NotCreator();
        if (newCreator == info.creator) revert InvalidInput();
        info.creator = newCreator;
        emit CreatorTransferred(tokenAddress, msg.sender, newCreator);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    /// @notice Hot-swap HyperSwap factory + LP lock. Reverts unless the new
    ///         `lpLock` already allowlists this Bonding — otherwise the next
    ///         `finalizeGraduation` would brick. Owners must
    ///         `lpLock.setLocker(bonding, true)` first.
    function setHyperswap(
        address newFactory,
        address newLpLock
    ) external onlyOwner {
        if (newFactory == address(0) || newLpLock == address(0)) revert ZeroAddress();
        if (!LPLock(newLpLock).isLocker(address(this))) revert LpLockNotConfigured();
        hyperswapFactory = newFactory;
        lpLock = newLpLock;
        emit HyperswapUpdated(newFactory, newLpLock);
    }

    /// @notice Hot-swap BounceTech `GlobalStorage`. Backstop for the unlikely
    ///         case BounceTech redeploys it (factory rotations flow through
    ///         automatically). Affects future launches only.
    function setBounceGlobalStorage(
        address newBounceGlobalStorage
    ) external onlyOwner {
        if (newBounceGlobalStorage == address(0)) revert ZeroAddress();
        address old = address(bounceGlobalStorage);
        bounceGlobalStorage = IBounceGlobalStorage(newBounceGlobalStorage);
        emit BounceGlobalStorageUpdated(old, newBounceGlobalStorage);
    }

    /// @notice Hot-swap the `Token` implementation cloned by future launches.
    ///         Existing clones bake their impl in at deploy time and are unaffected.
    function setTokenImplementation(
        address newImpl
    ) external onlyOwner {
        if (newImpl == address(0)) revert ZeroAddress();
        // Probe that the new impl can produce a vanity-suffixed clone. If
        // structurally broken, fail here rather than silently bricking every
        // user's `launch()`.
        VanityMining.mine(address(0x1), bytes32(0), bytes32(0), newImpl, address(this), 0);
        address old = tokenImplementation;
        tokenImplementation = newImpl;
        emit TokenImplementationUpdated(old, newImpl);
    }

    function addRouter(
        address router_
    ) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        if (!_routers.add(router_)) revert RouterAlreadyAdded();
        emit RouterAdded(router_);
    }

    function removeRouter(
        address router_
    ) external onlyOwner {
        if (!_routers.remove(router_)) revert RouterNotFound();
        if (_routers.length() == 0) revert MustKeepOneRouter();
        emit RouterRemoved(router_);
    }

    function isRouter(
        address router_
    ) external view returns (bool) {
        return _routers.contains(router_);
    }

    function getRouters() external view returns (address[] memory) {
        return _routers.values();
    }

    // ─── Internals ───────────────────────────────────────────────────────

    /// @dev `tokenHolder` is where `Router` pulls LT from / delivers tokens to
    ///      (the calling Zap). `trader` is event-only attribution (the user EOA).
    function _executeBuy(
        address tokenHolder,
        address trader,
        uint256 amountIn,
        address tokenAddress
    ) internal returns (uint256 tokensOut, uint256 amountInUsed) {
        (amountInUsed, tokensOut) = router.buy(amountIn, tokenAddress, tokenHolder);

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
        TokenInfo storage info = _tokenInfo[tokenAddress];
        info.lifecycle = Lifecycle.Graduating;

        (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) =
            _prepareGraduationLiquidity(tokenAddress);

        pendingGraduation[tokenAddress] = PendingGraduation({
            tokensForLP: tokensForLP,
            ltFromPair: ltFromPair,
            lpBurned: lpBurned,
            unsoldBurned: unsoldBurned,
            // forge-lint: disable-next-line(unsafe-typecast)
            pendingSince: uint64(block.timestamp)
        });

        emit TokenGraduating(tokenAddress, tokensForLP, ltFromPair, lpBurned, unsoldBurned);
    }

    /// @notice Phase 2: seed the HyperSwap LP and lock it. Permissionless —
    ///         keeper drives the happy path; anyone can rescue a stuck token.
    /// @dev Bypasses the HyperSwap V2 router and calls `pair.mint(lpLock)`
    ///      directly. This is brick-proof against a front-runner pre-creating
    ///      the pair and dust-seeding it between phases.
    function finalizeGraduation(
        address tokenAddress
    ) external nonReentrant {
        TokenInfo storage info = _tokenInfo[tokenAddress];
        if (info.lifecycle != Lifecycle.Graduating) revert NotGraduating();

        address lt = info.ltAddress;
        PendingGraduation memory p = pendingGraduation[tokenAddress];

        address hyperPair = _ensureHyperswapPair(tokenAddress, lt);
        uint256 liquidity = _seedHyperswapDirect(tokenAddress, lt, hyperPair, p.tokensForLP, p.ltFromPair);

        info.lifecycle = Lifecycle.Graduated;
        graduatedPair[tokenAddress] = hyperPair;
        delete pendingGraduation[tokenAddress];

        LPLock(lpLock).recordLock(tokenAddress, hyperPair, liquidity);

        emit TokenGraduated(tokenAddress, hyperPair, liquidity, p.tokensForLP, p.lpBurned, p.unsoldBurned);
    }

    /// @dev Burns unsold curve tokens, drains LT, computes `tokensForLP` for
    ///      zero-gap LP seeding, burns the LP excess.
    ///
    ///      Price equality: `tokensForLP / ltFromPair = tokenReserve / assetReserve`.
    ///      With virtual `tokenReserve = totalSupply` and `curveSupply = 75%`, the
    ///      parabola `tokensForLP(sold) = sold·(S−sold)/S` peaks at
    ///      `S/4 = LP_RESERVE` when `sold = S/2`, so `tokensForLP ≤ LP_RESERVE`
    ///      is mathematically invariant. The cap is defensive.
    function _prepareGraduationLiquidity(
        address tokenAddress
    ) internal returns (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) {
        address pairAddr = _tokenInfo[tokenAddress].pair;
        (uint256 tokenReserve, uint256 assetReserve) = IPair(pairAddr).getReserves();

        unsoldBurned = IERC20(tokenAddress).balanceOf(pairAddr);
        if (unsoldBurned > 0) {
            Token(tokenAddress).burn(pairAddr, unsoldBurned);
        }

        ltFromPair = router.graduate(tokenAddress);

        tokensForLP = assetReserve == 0 ? 0 : (ltFromPair * tokenReserve) / assetReserve;
        if (tokensForLP > LP_RESERVE) tokensForLP = LP_RESERVE;

        lpBurned = LP_RESERVE - tokensForLP;
        if (lpBurned > 0) {
            Token(tokenAddress).burn(address(this), lpBurned);
        }
    }

    function _ensureHyperswapPair(
        address tokenA,
        address tokenB
    ) internal returns (address pair) {
        IUniswapV2Factory hsFactory = IUniswapV2Factory(hyperswapFactory);
        pair = hsFactory.getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = hsFactory.createPair(tokenA, tokenB);
        }
    }

    /// @dev Direct `transfer → pair.mint`, bypassing the V2 router so a
    ///      front-runner who pre-seeds reserves can't brick the call. Skewed
    ///      LP ratio from a hostile pre-seed is bounded and arbed out post-grad.
    function _seedHyperswapDirect(
        address tokenAddress,
        address lt,
        address pair,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) internal returns (uint256 liquidity) {
        IERC20(tokenAddress).safeTransfer(pair, tokensForLP);
        IERC20(lt).safeTransfer(pair, ltFromPair);
        liquidity = IUniswapV2Pair(pair).mint(lpLock);
    }

    function _getCurveState(
        address tokenAddress
    ) internal view returns (uint256 curveSupply, uint256 ltReserve) {
        address pair = _tokenInfo[tokenAddress].pair;
        (curveSupply, ltReserve) = IPair(pair).getReserves();
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
