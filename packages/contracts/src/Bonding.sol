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

/// @title Bonding
/// @notice Constant-product bonding curve for the launchpad. Each token pairs with a
///         BounceTech Leveraged Token (LT) as its reserve asset.
/// @dev Forked from Virtuals Protocol `Bonding.sol`. Key design pillars: virtual
///      reserves on the curve `Pair`, dual-trigger graduation (USD threshold OR
///      curve sellout), two-phase graduation split (phase 1 inline in the
///      threshold-crossing buy, phase 2 permissionless and big-block), dynamic
///      LP seeding (zero-gap between curve close and LP open), and
///      brick-resistance against hostile pre-seeds of the post-grad pair. The
///      most subtle code paths are `_enterGraduating`, `finalizeGraduation`,
///      and `_prepareGraduationLiquidity` — natspec on each function below
///      contains the rationale.
/// @dev Owner is the protocol multisig. Uses `Ownable2StepUpgradeable` so a
///      bad `transferOwnership` can be cancelled (or simply ignored by the
///      pending owner) before it takes effect — single-step transfer to a
///      fat-fingered or contract-incompatible address would otherwise brick
///      every owner-only path on the live proxy.
///
///      Storage uses ERC-7201 namespaced layout (no `__gap` needed). All
///      mutable state lives in `BondingStorage` at
///      `_BONDING_STORAGE_LOCATION`.
contract Bonding is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev Virtual liquidity seeded at launch, in USDC (18-dp). Every
    ///      `*Usd`-named value and every "USD" figure in this contract is
    ///      a USDC amount scaled to 18-dp: the protocol treats 1 USDC as
    ///      1 USD and holds no price oracle.
    ///      Combined with the LT's launch-time `exchangeRate()` to derive
    ///      the launch-time `virtualLtReserve`, which permanently shapes
    ///      the curve via `K = TOTAL_SUPPLY * virtualLtReserve`. Pairs
    ///      with `Deploy.s.sol::GRADUATION_THRESHOLD_USD` at `$9K`
    ///      (3× peg preserved). Constant — changing it for an existing
    ///      proxy is a no-op because `K` is baked into each `Pair` at
    ///      `mint` and never recomputed.
    uint256 public constant VIRTUAL_LIQUIDITY_USD = 3000 ether;

    uint256 public constant CURVE_BPS = 7500;
    uint256 public constant LP_RESERVE_BPS = 2500;
    uint256 public constant BPS_DENOM = 10_000;

    uint256 public constant LP_RESERVE = (1_000_000_000 ether * LP_RESERVE_BPS) / BPS_DENOM;

    /// @notice A mint pre-seed at or below this fraction (bps) of BOTH
    ///         LP-bound sides is seeded with a direct mint at the cached
    ///         curve-close ratio instead of being rebalanced: against reserves
    ///         this small the rebalance swap is too coarse to reach the ratio,
    ///         so a direct mint opens the pool cleanly.
    ///
    ///         The direct mint is not free: the empty-mint `min()` formula
    ///         donates the over-funded side of the deposit to the pre-seeder's
    ///         pre-existing LP, so this band doubles as the cap on that
    ///         subsidy (≈ this fraction of `ltFromPair`). It is deliberately
    ///         tiny (1 bp) so the subsidy is economically negligible. Any
    ///         larger pre-seed exceeds the band and takes the rebalance path,
    ///         which arbs the pre-seed back to the curve-close ratio in the
    ///         same tx and leaves the pre-seeder net-negative — so the only
    ///         pre-seeds that reach the direct mint are ones whose subsidy is
    ///         bounded here, plus genuine dust that the `_pairRebalance`
    ///         swap-rounds-to-zero fallback would route here anyway.
    uint256 public constant DIRECT_MINT_PRESEED_BPS = 1;

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
    ///      here you MUST also update the matching value in the frontend
    ///      production miner and the Solidity test miner — both must
    ///      mirror this constant. Diverging any of those bricks token
    ///      creation.
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
    ///         is the system's first-block-sniper mitigation: no other buyer
    ///         can race the creator into block N or pile in at N+1..N+3. The
    ///         gate is buy-only and does not lock the seed in — see
    ///         `_enforceLaunchDelay`.
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
    ///         `finalizeGraduation` for the rationale.
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
        ///      change against every currently-trading token. Tuning
        ///      requires a UUPS upgrade with a `reinitializer`.
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
        ///      `_seedUniswapV2Direct`. Set at `initialize` and immutable
        ///      thereafter — rotation requires a UUPS upgrade so the
        ///      change is visible on-chain ahead of any in-flight
        ///      graduation, same contract as `uniswapV2Factory`. The
        ///      empty-pair fast path bypasses the router entirely.
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
    /// @notice Phase 2 complete: the V2 LP has been seeded and locked.
    /// @param liquidity LP tokens minted to the lock — the authoritative
    ///        locked-liquidity figure.
    /// @param tokensInLP The phase-1 LP-seed target cached in
    ///        `pendingGraduation` (pinned at the last curve price). Equals the
    ///        tokens actually deposited on the normal empty-pair seed; when the
    ///        pair already holds live reserves the deposit rebalances, so this
    ///        is the intended target rather than the exact amount deposited.
    ///        Derive actual reserves from `liquidity` / the pair state.
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
    /// @notice Emitted by `finalizeGraduation`'s auto-sweep when this
    ///         graduation's rebalance leftover (Regime 3 hostile-pre-seed
    ///         defense) is transferred to the protocol owner. LT escrowed
    ///         for concurrent graduations or sitting as stray dust is
    ///         retained in `Bonding` (it's `protectedLT`, off-limits to
    ///         the sweep). Honest graduations don't emit this — there's
    ///         no residue.
    event LTRescued(address indexed token, address indexed to, uint256 amount);

    error TokenNotTrading();
    /// @dev Distinct from `TokenNotTrading` so the UI can render a "graduating"
    ///      overlay rather than a generic error.
    error TokenIsGraduating();
    error NotGraduating();
    /// @dev `triggerGraduation` called when `canGraduate(token)` is false.
    error NotGraduatable();
    error ZeroAddress();
    error InvalidInput();
    error SlippageExceeded();
    error NotCreator();
    error NotRouter();
    error RouterAlreadyAdded();
    error RouterNotFound();
    error MustKeepOneRouter();
    error ZeroExchangeRate();
    /// @dev Launch-time `exchangeRate` so low the curve's LT reserve would
    ///      overflow the HyperSwap V2 pair's `uint112` reserve slot at
    ///      graduation, bricking `finalizeGraduation`.
    error ExchangeRateTooLow();
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

    /// @param graduationThresholdUsd_ Immutable USDC trigger (18-dp). Must be
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

    /// @dev Launch-time `exchangeRate()` snapshot permanently shapes the
    ///      curve via `K = TOTAL_SUPPLY * virtualLtReserve`. The
    ///      `VIRTUAL_LIQUIDITY_USD / rate` division pins the opening market
    ///      cap at `~VIRTUAL_LIQUIDITY_USD` regardless of the LT's price;
    ///      what the snapshot fixes is the curve's USD-denominated depth,
    ///      which then drifts with the LT.
    ///
    ///      Drift is accepted: it's inherent to using a leveraged token as
    ///      the reserve (same drift class as the phase-1 → phase-2 gap on
    ///      `finalizeGraduation`). The snapshot is also a pre-checkpoint
    ///      view — `exchangeRate()` doesn't settle the LT's accrued
    ///      streaming fee until the seed buy's `mint` checkpoints it moments
    ///      later — so the curve opens off a rate marginally above the
    ///      settled one, bounded by the pending fee and immaterial. A
    ///      donation attack on the LT's `baseAssetBalance` to skew the
    ///      snapshot is cost-negative — the donation is irrevocable and the
    ///      only direct victim is the creator's `MIN_SEED_USDC`-floored seed
    ///      buy.
    ///
    ///      No `(min, max)` band on `LaunchParams` by design: a band
    ///      introduces a launch-failure mode users can't diagnose and forces
    ///      the frontend into a default tolerance that's either too tight
    ///      (legitimate launches fail) or too loose (decorative).
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
        // The raised LT reserve peaks at `3 * virtualLtReserve` (curve sell-out)
        // and is later deposited into a HyperSwap V2 pair, whose reserves are
        // `uint112`. Bound it at launch (4x headroom) so graduation can never
        // exceed that slot.
        if (virtualLtReserve > type(uint112).max / 4) revert ExchangeRateTooLow();

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
        // A graduatable curve token must graduate, not sell back below the
        // threshold. The user-facing router triggers graduation up front via
        // `triggerGraduation`; rejecting here stops any router that skipped
        // that step from un-ripening a ready graduation.
        if (canGraduate(tokenAddress)) revert TokenIsGraduating();

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
    ///         `exchangeRate()` is a view that doesn't settle the LT's
    ///         accrued streaming fee (only mint / redeem / agent checkpoints
    ///         do), so the USD leg can read marginally high and trip the
    ///         threshold a touch early. Bounded by the pending fee,
    ///         one-directional, and the same accepted drift class as the
    ///         launch snapshot (`_deployAndSeed`); the inline post-buy path
    ///         is unaffected (`Zap.buy`'s `mint` checkpoints in the same tx)
    ///         and LP seeding never reads the rate, so the pool still opens
    ///         at the exact curve-close price.
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

    /// @notice LT amount that must be added to the curve's `assetReserve` for
    ///         `canGraduate(token_)` to become true. `0` when already
    ///         graduatable or not in `Lifecycle.Curve`.
    /// @dev    Composes the two `canGraduate` legs (supply trigger from
    ///         `IPair.tokenBalance() == 0`, USD trigger from
    ///         `realLtRaised × exchangeRate / 1e18 ≥ graduationThresholdUsd`)
    ///         and returns the cap-binding `min`. Ceil-div on the USD leg
    ///         so the resulting buy strictly crosses the threshold.
    function previewLtUntilGraduation(
        address token_
    ) external view returns (uint256) {
        BondingStorage storage $ = _s();
        TokenInfo storage info = $.tokenInfo[token_];
        if (info.creator == address(0)) return 0;
        if (info.lifecycle != Lifecycle.Curve) return 0;

        address pair = info.pair;
        uint256 realBalance = IPair(pair).tokenBalance();
        if (realBalance == 0) return 0;

        (uint256 reserveToken, uint256 reserveAsset) = IPair(pair).getReserves();

        uint256 ltUntilThreshold = type(uint256).max;
        uint256 exchangeRate = IBounceLeveragedToken(info.ltAddress).exchangeRate();
        if (exchangeRate > 0) {
            uint256 realLtRaised = reserveAsset - _launchTimeVirtualLtReserve(token_, pair);
            uint256 thresholdRealLt = ($.graduationThresholdUsd * 1e18 + exchangeRate - 1) / exchangeRate;
            if (realLtRaised >= thresholdRealLt) return 0;
            ltUntilThreshold = thresholdRealLt - realLtRaised;
        }

        // Donation-inflated `realBalance`: supply trigger unreachable, defer to USD leg.
        if (realBalance >= reserveToken) return ltUntilThreshold;

        uint256 cappedReserveToken = reserveToken - realBalance;
        uint256 cappedReserveAsset = (IPair(pair).k() + cappedReserveToken - 1) / cappedReserveToken;
        uint256 ltUntilSupply = cappedReserveAsset - reserveAsset;

        return ltUntilSupply < ltUntilThreshold ? ltUntilSupply : ltUntilThreshold;
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
    ///         automatically). Also re-points the live per-trade minimum for
    ///         existing tokens, since `Zap.minUsdcAmount()` reads
    ///         `minTransactionSize()` through this pointer on every buy/sell
    ///         and on seed sizing.
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

    // ─── Internals ───────────────────────────────────────────────────────

    /// @dev Anti-snipe gate on the buy path. Inside the launch tx the seed
    ///      buy fires the transient bypass set in `launch()`, so the
    ///      creator's seed always lands. Any other buy (including same-block
    ///      sniper bundles in a separate tx) sees a cleared transient slot
    ///      and reverts until
    ///      `block.number > launchBlock + LAUNCH_TRADING_DELAY_BLOCKS`. The
    ///      bypass is consumed on first use so a malicious router that
    ///      crammed multiple buys into one tx still only gets one through.
    ///
    ///      Only buys are gated; the creator can sell the seed back into the
    ///      curve within the window. We accept this for the same reason we
    ///      don't cap the seed (below): the creator controls their own open
    ///      regardless and cannot be forced to leave the seed in the curve.
    ///
    ///      We do **not** cap the seed-buy size. Some creators legitimately
    ///      seed >50% of a curve and burn the result post-launch as a supply
    ///      sink — capping would block that pattern, and the cap is
    ///      trivially bypassable anyway via a second wallet at
    ///      `launchBlock + LAUNCH_TRADING_DELAY_BLOCKS + 1`. This is
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

    /// @notice Permissionless trigger for phase 1 of graduation. Same flow as
    ///         the inline post-buy trigger inside `_executeBuy`, but callable
    ///         without any buy. Closes the case where `canGraduate` is true
    ///         (LT appreciation pushed the curve past the USD threshold) but
    ///         the closing buy on the curve would mint below the BounceTech
    ///         LT mint floor and revert with `BelowMinTransactionSize`,
    ///         making the token un-graduatable via `Zap.buy`.
    /// @dev    `_enterGraduating` reads pair reserves and the launch-time
    ///         virtual reserve only — it does not depend on a buy having
    ///         just landed, so the same logic is safe to expose as a
    ///         standalone entry point. The lifecycle pre-checks mirror
    ///         `Bonding.buy`; the launch trading delay is intentionally
    ///         not enforced because `canGraduate` already requires either
    ///         the USD threshold or full curve sellout, both of which are
    ///         unreachable from a fresh launch within the delay window.
    function triggerGraduation(
        address tokenAddress
    ) external nonReentrant {
        TokenInfo storage info = _s().tokenInfo[tokenAddress];
        if (info.creator == address(0)) revert TokenNotTrading();
        if (info.lifecycle == Lifecycle.Graduating) revert TokenIsGraduating();
        if (info.lifecycle != Lifecycle.Curve) revert TokenNotTrading();
        if (!canGraduate(tokenAddress)) revert NotGraduatable();
        _enterGraduating(tokenAddress);
    }

    /// @notice Phase 2: seed the V2 LP and lock it. Permissionless —
    ///         keeper drives the happy path; anyone can rescue a stuck token.
    /// @dev Bypasses the V2 router and calls `pair.mint(lpLock)`
    ///      directly. This is brick-proof against a front-runner pre-creating
    ///      the pair and dust-seeding it between phases.
    /// @dev Exchange-rate drift between phase 1 and phase 2 is accepted by
    ///      design. The cached `(tokensForLP, ltFromPair)` are pure pair-
    ///      state arithmetic — see `_prepareGraduationLiquidity`, which
    ///      never reads `exchangeRate()` — so the LP opens at the exact
    ///      LT-per-token ratio the curve closed at, regardless of how long
    ///      phase 2 takes. What drifts is only the USD denomination of the
    ///      LT side, which is inherent to using a leveraged token as the
    ///      curve reserve: holders accept that exposure when they buy in.
    ///      A keeper Worker drives finalize within ~60s of `TokenGraduating`,
    ///      so the practical drift window is single-digit seconds. No
    ///      freshness timestamp / staleness gate: a recompute would return
    ///      byte-identical values (inputs are frozen while
    ///      `Lifecycle.Graduating`), and re-pricing the LP at the live
    ///      `exchangeRate()` would break the zero-gap-in-LT-units invariant.
    function finalizeGraduation(
        address tokenAddress
    ) external nonReentrant {
        BondingStorage storage $ = _s();
        TokenInfo storage info = $.tokenInfo[tokenAddress];
        if (info.lifecycle != Lifecycle.Graduating) revert NotGraduating();

        address lt = info.ltAddress;
        PendingGraduation memory p = $.pendingGraduation[tokenAddress];

        // Anything in this contract beyond `p.ltFromPair` belongs to a
        // concurrent graduation on the same LT (Phase 1 transferred it
        // via `Router.graduate`) or to stray dust. Either way it is
        // off-limits to this graduation's deposit and sweep — see
        // `_routerDepositAndDispose` and `_sweepLTToOwner`.
        // Saturating subtract: a balance below `p.ltFromPair` shouldn't
        // be reachable in normal operation, but we keep finalize from
        // bricking on a Panic if any future code path or non-canonical
        // LT briefly violates the invariant.
        uint256 ltBalance = IERC20(lt).balanceOf(address(this));
        uint256 protectedLT = ltBalance > p.ltFromPair ? ltBalance - p.ltFromPair : 0;

        address lpPair = _ensureUniswapV2Pair(tokenAddress, lt);
        uint256 liquidity = _seedUniswapV2Direct(tokenAddress, lt, lpPair, p.tokensForLP, p.ltFromPair, protectedLT);

        _sweepLTToOwner(lt, protectedLT);

        info.lifecycle = Lifecycle.Graduated;
        $.graduatedPair[tokenAddress] = lpPair;
        delete $.pendingGraduation[tokenAddress];

        LPLock($.lpLock).recordLock(tokenAddress, lpPair, liquidity);

        emit TokenGraduated(tokenAddress, lpPair, liquidity, p.tokensForLP, p.lpBurned, p.unsoldBurned);
    }

    /// @dev Send LT held by this contract above `keep` to the owner,
    ///      emitting `LTRescued`. Called at the end of
    ///      `finalizeGraduation` with `keep = protectedLT` (any escrow
    ///      that doesn't belong to this graduation), so only THIS
    ///      graduation's rebalance residue lands on the owner. No-op on
    ///      the empty-pair fast path (nothing to sweep).
    function _sweepLTToOwner(
        address lt,
        uint256 keep
    ) internal {
        uint256 bal = IERC20(lt).balanceOf(address(this));
        if (bal <= keep) return;
        uint256 amount = bal - keep;
        address recipient = owner();
        IERC20(lt).safeTransfer(recipient, amount);
        emit LTRescued(lt, recipient, amount);
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

        unsoldBurned = IPair(pairAddr).tokenBalance();
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

    /// @dev LP-seeding into the HyperSwap pair, hardened against hostile
    ///      pre-seeds. Three regimes:
    ///
    ///        1. **No LP minted yet — `totalSupply == 0` (~99% of
    ///           graduations).** A pristine empty pair, or a dust pre-seed
    ///           (`transfer(pair, dust) + sync()` leaves `reserves > 0` but
    ///           `totalSupply == 0`). Direct mint at exactly
    ///           `(tokensForLP, ltFromPair)` — V2's first-liquidity branch
    ///           makes those amounts the sole price input, so the pool opens
    ///           at the curve-close ratio and any dust becomes reserves with
    ///           no LP claim.
    ///        2. **Pure-donation pre-seed.** Attacker `transfer`'d to the
    ///           pair without `mint` (balance > 0, reserves == 0).
    ///           `pair.skim(address(this))` pulls the donation into
    ///           `Bonding`; path then collapses to (1). Donated TOKEN is
    ///           burned alongside the empty-pair mint; donated LT is
    ///           handled by `finalizeGraduation`'s post-bookend
    ///           `_sweepLTToOwner` (which uses `protectedLT` snapshotted
    ///           BEFORE skim, so the donation is correctly classified as
    ///           rebalance residue rather than concurrent-graduation
    ///           escrow). NEVER routed to `LPLock` — `LPLock` has no
    ///           rescue path in v1, so anything that lands there is
    ///           permanently stuck.
    ///        3. **Mint pre-seed.** Attacker called `pair.mint` against a
    ///           self-funded seed, baking a hostile (TOKEN, LT) ratio into
    ///           the pool. Without intervention `pair.mint(lpLock)`'s
    ///           `min(amount0·S/r0, amount1·S/r1)` formula would (a) open
    ///           the LP off curve-close-price and (b) donate the larger arm
    ///           to the attacker's pre-existing LP. We rebalance via a
    ///           direct `pair.swap` toward the curve-close ratio, then
    ///           deposit the remaining inventory via the router's
    ///           `quote()`-based `addLiquidity` — which only pulls the
    ///           optimal amounts at the post-swap ratio, so neither side
    ///           becomes a `min()` donation. Off-ratio TOKEN remainder is
    ///           burned; off-ratio LT remainder is auto-swept to the owner
    ///           by `finalizeGraduation`'s post-bookend (see its natspec).
    ///           When the seed is small enough that the fee-charging swap
    ///           quote rounds to zero, no swap can move the ratio — but the
    ///           reserves are then negligible against this graduation's
    ///           inventory, so we fall back to the regime-1 direct mint
    ///           (`_seedDirectMint`) and open at the cached ratio anyway.
    ///           The captured LP share is bounded by
    ///           `max(reserveToken/tokensForLP, reserveLT/ltFromPair)`,
    ///           which vanishes for any seed that small.
    ///
    ///      Brick resistance: the rebalance swap input is capped at our
    ///      per-side budget; a swap whose fee-charging `getAmountOut` would
    ///      round to zero (which would otherwise revert `pair.swap` with
    ///      `INSUFFICIENT_OUTPUT_AMOUNT`) is replaced by the direct-mint
    ///      fallback; the deposit uses `addLiquidity(min=1, min=1)`; and the
    ///      empty/donation regimes don't touch the router or `pair.swap`. So
    ///      a hostile pre-seed of any shape cannot DoS `finalizeGraduation`.
    ///
    ///      Asymmetric router usage: **the rebalance swap is direct-to-pair
    ///      (`pair.swap`), not router-mediated.** HyperSwap mainnet's V2
    ///      router replaces every canonical swap function with FoT-only
    ///      variants that take a non-standard `referrer` argument (selectors
    ///      `ac3893ba` / `b4822be3` / `52aa4c22`).
    ///      `Zap._swapOnUniswapV2` already uses `pair.swap` for the
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
        uint256 ltFromPair,
        uint256 protectedLT
    ) internal returns (uint256 liquidity) {
        // Regime 2 — pull any donation pre-seed into this contract so it
        // doesn't pollute the post-swap ratio. Routed to `address(this)`
        // (NOT `lpLock`) so donated TOKEN can be burned and donated LT
        // can be swept to the owner via `_sweepLTToOwner` — `LPLock` has
        // no rescue path, so anything sent there is permanently stuck.
        // No-op on a freshly-created pair (balance == reserves == 0).
        IUniswapV2Pair(pair).skim(address(this));

        // Regime 1 — no LP minted yet (`totalSupply == 0`): a pristine empty
        // pair, or a dust pre-seed from `transfer(pair, dust) + sync()` that
        // leaves reserves non-zero while supply is still zero. Keying on
        // supply rather than reserves routes the dust shape here instead of
        // the rebalance path: with zero supply V2 mints from our amounts
        // alone, so the pool opens at the cached ratio and any dust becomes
        // reserves with no LP claim.
        if (IUniswapV2Pair(pair).totalSupply() == 0) {
            return _seedDirectMint(tokenAddress, lt, pair, tokensForLP, ltFromPair);
        }

        // Regime 3 — mint pre-seed: rebalance, then deposit balanced subset.
        // `lpLock_` re-read from storage inside `_routerDepositAndDispose`.
        // Reserves and token-ordering re-read inside `_seedRebalancing` to
        // keep this function's stack pressure under solc's 16-slot ceiling
        // without `viaIR`.
        return _seedRebalancing(tokenAddress, lt, pair, tokensForLP, ltFromPair, protectedLT);
    }

    /// @dev Transfer the full `(tokensForLP, ltFromPair)` to the pair and
    ///      `mint` the LP to `LPLock`, opening at the exact cached
    ///      curve-close ratio. Used by the empty-pair regime and as the
    ///      dust-pre-seed fallback in `_seedRebalancing` — against dust
    ///      reserves the V2 `min()` formula's donation to any pre-existing
    ///      LP is negligible (see `_seedUniswapV2Direct` natspec). Any TOKEN
    ///      remainder (a skimmed pure-donation pre-seed) is burned; the LT
    ///      remainder is left for `finalizeGraduation`'s `_sweepLTToOwner`
    ///      post-bookend.
    function _seedDirectMint(
        address tokenAddress,
        address lt,
        address pair,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) internal returns (uint256 liquidity) {
        IERC20(tokenAddress).safeTransfer(pair, tokensForLP);
        IERC20(lt).safeTransfer(pair, ltFromPair);
        liquidity = IUniswapV2Pair(pair).mint(_s().lpLock);
        uint256 leftoverToken = IERC20(tokenAddress).balanceOf(address(this));
        if (leftoverToken > 0) {
            Token(tokenAddress).burn(address(this), leftoverToken);
        }
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
        uint256 ltFromPair,
        uint256 protectedLT
    ) internal returns (uint256 liquidity) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        bool tokenIs0 = IUniswapV2Pair(pair).token0() == tokenAddress;
        (uint256 reserveToken, uint256 reserveLT) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));

        // Below the band on BOTH sides, overpower the pre-seed with a direct
        // mint at the cached ratio: the rebalance swap is too coarse to reach
        // the ratio against such small reserves, and the pre-existing LP's
        // claim on the deposit stays bounded by `DIRECT_MINT_PRESEED_BPS`. A
        // side that is large relative to its LP target still takes the
        // rebalance path so it isn't donated under the empty-mint `min()`.
        if (
            reserveToken * BPS_DENOM <= tokensForLP * DIRECT_MINT_PRESEED_BPS
                && reserveLT * BPS_DENOM <= ltFromPair * DIRECT_MINT_PRESEED_BPS
        ) {
            return _seedDirectMint(tokenAddress, lt, pair, tokensForLP, ltFromPair);
        }

        // Budget reads `balanceOf(this)` rather than `tokensForLP` /
        // `ltFromPair` so any skim donation contributes to the rebalance
        // and not only to `_routerDepositAndDispose`'s deposit.
        // Direction: pool TOKEN-rich vs target ⇒ swap LT in (TOKEN out).
        // Pool LT-rich ⇒ swap TOKEN in (LT out). Bounded by uint112 reserves
        // and curve-close-shape targets, both products fit in uint256.
        // When `_pairRebalance` returns false the seed is too small for any
        // swap to move the ratio (its fee-charging quote rounds to zero), so
        // the reserves are negligible against this graduation's inventory:
        // overpower them with a direct mint at the cached ratio rather than
        // letting the router deposit at the attacker's ratio. A swap that
        // does fire leaves the pool ≈ at target for the router deposit.
        if (reserveToken * ltFromPair > reserveLT * tokensForLP) {
            // Pool TOKEN-rich. tokenIn = lt, tokenOut = tokenAddress.
            // tokenInIs0 = (lt is token0) = !tokenIs0.
            if (!_pairRebalance(
                    RebalanceParams({
                        pair: pair,
                        tokenIn: lt,
                        tokenInIs0: !tokenIs0,
                        reserveIn: reserveLT,
                        reserveOut: reserveToken,
                        targetN: ltFromPair,
                        targetD: tokensForLP,
                        maxSwap: _swapBudget(_ltSwapInventory(lt, protectedLT))
                    })
                )) {
                return _seedDirectMint(tokenAddress, lt, pair, tokensForLP, ltFromPair);
            }
        } else if (reserveToken * ltFromPair < reserveLT * tokensForLP) {
            // Pool LT-rich. tokenIn = tokenAddress, tokenInIs0 = tokenIs0.
            if (!_pairRebalance(
                    RebalanceParams({
                        pair: pair,
                        tokenIn: tokenAddress,
                        tokenInIs0: tokenIs0,
                        reserveIn: reserveToken,
                        reserveOut: reserveLT,
                        targetN: tokensForLP,
                        targetD: ltFromPair,
                        maxSwap: _swapBudget(IERC20(tokenAddress).balanceOf(address(this)))
                    })
                )) {
                return _seedDirectMint(tokenAddress, lt, pair, tokensForLP, ltFromPair);
            }
        }
        // else: pool already at curve-close ratio (rare — e.g. attacker
        // pre-seeded at exactly target). Skip swap, deposit directly.

        return _routerDepositAndDispose(tokenAddress, lt, protectedLT);
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
    ///      is bricking.
    function _swapBudget(
        uint256 budget
    ) internal pure returns (uint256) {
        return (budget * 99) / 100;
    }

    /// @dev Saturating subtract matches `_routerDepositAndDispose` so a
    ///      future violation of the `balanceOf >= protectedLT` invariant
    ///      can't brick `finalizeGraduation`.
    function _ltSwapInventory(
        address lt,
        uint256 protectedLT
    ) internal view returns (uint256) {
        uint256 bal = IERC20(lt).balanceOf(address(this));
        return bal > protectedLT ? bal - protectedLT : 0;
    }

    /// @dev Rebalance leg: compute no-fee swap input, cap at budget,
    ///      execute via direct `pair.swap`. Bypasses the V2 router because
    ///      HyperSwap mainnet's router has no canonical
    ///      `swapExactTokensForTokens` — only FoT-with-`referrer` variants
    ///      with a non-standard ABI. Same direct-to-pair pattern
    ///      `Zap._swapOnUniswapV2` uses for the same reason.
    ///
    ///      We read the output from the pair's own fee-aware quote
    ///      (`getAmountOut`) and pass it to `pair.swap`, so the value always
    ///      tracks the pair's live per-token fee and stays consistent with
    ///      its K-invariant check.
    ///
    ///      Returns `true` if a swap executed, `false` if it was skipped.
    ///      Skips when the no-fee input rounds to zero (`s == 0`) or when
    ///      the pair's fee-charging `getAmountOut(s)` rounds to zero — the
    ///      latter would otherwise revert `pair.swap` with
    ///      `INSUFFICIENT_OUTPUT_AMOUNT`. Both only happen for a seed too
    ///      small to move the ratio by a whole wei of output; the caller
    ///      reads the `false` return and falls back to a direct mint that
    ///      overpowers the dust at the cached ratio.
    ///
    ///      No router approval needed (we transfer to the pair directly),
    ///      so no allowance hygiene to worry about.
    function _pairRebalance(
        RebalanceParams memory p
    ) internal returns (bool) {
        uint256 s = _noFeeSwapInput(p.reserveIn, p.reserveOut, p.targetN, p.targetD, p.maxSwap);
        if (s == 0) return false;

        // Quote from the pair so the output tracks its live fee; a value
        // derived from a stale fee rate would trip the pair's K-check.
        uint256 expectedOut = IUniswapV2Pair(p.pair).getAmountOut(s, p.tokenIn);
        if (expectedOut == 0) return false;

        IERC20(p.tokenIn).safeTransfer(p.pair, s);
        (uint256 amount0Out, uint256 amount1Out) = p.tokenInIs0 ? (uint256(0), expectedOut) : (expectedOut, uint256(0));
        IUniswapV2Pair(p.pair).swap(amount0Out, amount1Out, address(this), new bytes(0));
        return true;
    }

    /// @dev Deposit leg: add liquidity at the post-swap pool ratio via the
    ///      router. The router's `quote()`-based balanced split only pulls
    ///      the optimal amounts (no `min()` donation); off-ratio remainder
    ///      stays in this contract and is disposed: TOKEN burned here, LT
    ///      auto-swept to the owner by `finalizeGraduation`'s post-bookend.
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
        address lt,
        uint256 protectedLT
    ) internal returns (uint256 liquidity) {
        BondingStorage storage $ = _s();
        address routerAddr = $.uniswapV2Router;
        address lpLock_ = $.lpLock;
        uint256 remToken = IERC20(tokenAddress).balanceOf(address(this));
        // Subtract `protectedLT` (LT that doesn't belong to this graduation
        // — concurrent escrows or stray dust, snapshotted at the top of
        // `finalizeGraduation`) so the deposit allowance can never pull
        // another graduation's earmark or accidentally absorb dust into a
        // locked LP.
        uint256 ltBal = IERC20(lt).balanceOf(address(this));
        uint256 remLT = ltBal > protectedLT ? ltBal - protectedLT : 0;

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
        // LT remainder is third-party — we cannot burn it. It stays in
        // this contract until `finalizeGraduation`'s post-bookend sweeps
        // it to the owner. Honest graduations never reach this code path,
        // so the residue is zero outside attack scenarios.
    }

    /// @dev Smallest swap input that drives the pool's reserve ratio
    ///      `(reserveIn + s) / (reserveOut - out)` to `targetN/targetD`
    ///      under the no-fee constant-product model:
    ///        `(reserveIn + s)² = reserveIn * reserveOut * targetN/targetD`
    ///      ⇒ `s = sqrt(reserveIn * reserveOut * targetN/targetD) - reserveIn`,
    ///      capped at `maxSwap`. The actual swap is fee-charging (the pair's
    ///      live fee), so the post-swap ratio drifts from the target by the
    ///      fee; the balanced-subset deposit absorbs the residual without
    ///      donating.
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
