// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
import {IPair} from "./interfaces/IPair.sol";
import {ILeveragedToken} from "./interfaces/ILeveragedToken.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "./interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "./interfaces/IUniswapV2Pair.sol";
import {LPLock} from "./LPLock.sol";

/// @title Bonding
/// @notice Constant-product bonding curve for the launchpad.
/// @dev Each token pairs with a BounceTech Leveraged Token (LT). K is computed per-token
///      from the LT's exchange rate so every token opens at ~$4K market cap.
///
///      Virtual reserves: the pair's `reserve0` is initialised to the *total* supply (1B)
///      while only the `curveSupply` (75%) of real tokens is transferred. This caps the
///      sellable supply at 750M and pins the post-sellout virtual reserve at 250M
///      (= `LP_RESERVE`). This gives:
///        • A deterministic "supply trigger" (all curve tokens sold).
///        • A USD trigger at `raisedLT * exchangeRate ≥ graduationThresholdUsd`
///          (defaults to $12K, mutable by the owner via `setGraduationThresholdUsd`).
///        • An invariant that `tokensForLP(sold) = sold·(S-sold)/S ≤ S/4 = LP_RESERVE`.
///
///      Upon graduation, the LP pool is seeded with exactly the tokens needed to match
///      the last curve price (`tokensForLP = raisedLT / lastPrice`), with excess burned
///      from the 250M LP reserve. This guarantees zero LP/curve price gap.
///
///      Graduation is split across two transactions to fit HyperEVM's small-block
///      gas ceiling (~2M):
///        Phase 1 (inline in the threshold-crossing buy): drain the curve, cache the
///                LP-bound amounts, flip lifecycle to `Graduating`, freeze trading.
///                Emits `TokenGraduating`.
///        Phase 2 (`finalizeGraduation`, permissionless big-block tx): create the
///                HyperSwap pair if needed, mint LP via direct `pair.mint(lpLock)`
///                (router-bypass — no slippage path that a front-runner can brick),
///                lock LP, flip lifecycle to `Graduated`. Emits `TokenGraduated`.
///      A Cloudflare Worker keeper handles the happy path; anyone can call
///      `finalizeGraduation` to rescue a stuck token.
///
///      Forked from Virtuals Protocol Bonding.sol.
contract Bonding is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    Factory public factory;
    Router public router;

    address public hyperswapRouter;
    address public lpLock;

    /// @notice EIP-1167 minimal-proxy implementation. Each `launch()` deploys a
    ///         45-byte clone that delegatecalls into this address. Set at
    ///         `initialize()` time and hot-swappable by the owner via
    ///         `setTokenImplementation` (affects future launches only —
    ///         already-deployed clones hard-code their impl in bytecode).
    address public tokenImplementation;

    /// @dev Authorised routers. Only addresses in this set may call `launch`,
    ///      `buy`, or `sell`. Managed via `addRouter` / `removeRouter`. The
    ///      set model (vs. a single `zap` address) allows seamless
    ///      router upgrades: deploy the new zap, `addRouter(newZap)`,
    ///      flip the frontend's canonical address, then `removeRouter(old)`
    ///      with no window in which users can't trade.
    EnumerableSet.AddressSet private _routers;

    uint256 public maxTx;

    /// @dev Target virtual LT reserve in 18-decimal USD. Controls opening market cap.
    ///      Since virtual reserve0 = totalSupply (1B), opening MC = VIRTUAL_LIQUIDITY_USD.
    uint256 public constant VIRTUAL_LIQUIDITY_USD = 100 ether;

    /// @dev Default graduation threshold seeded at deploy / upgrade. Mutable
    ///      via `setGraduationThresholdUsd`. See `graduationThresholdUsd`.
    uint256 public constant DEFAULT_GRADUATION_THRESHOLD_USD = 12_000 ether;

    /// @dev Lower bound on `graduationThresholdUsd`. Pegged to the opening
    ///      virtual liquidity so a freshly-launched curve can never be
    ///      pre-graduated by an admin setting an absurdly low threshold.
    uint256 public constant MIN_GRADUATION_THRESHOLD_USD = VIRTUAL_LIQUIDITY_USD;

    /// @dev Upper bound on `graduationThresholdUsd`. Defensive against fat-finger
    ///      input — well above any realistic launchpad threshold.
    uint256 public constant MAX_GRADUATION_THRESHOLD_USD = 1_000_000 ether;

    /// @dev Graduation fires when real LT reserve * exchangeRate >= this value
    ///      (18-decimal USD). Globally applied — a change re-scores every
    ///      currently-trading token on its next `buy`/`sell`. This is
    ///      deliberate: lowering the dial mid-flight is the *only* way to
    ///      affect the long tail of stale tokens. Bounded by
    ///      `MIN_GRADUATION_THRESHOLD_USD` / `MAX_GRADUATION_THRESHOLD_USD`.
    uint256 public graduationThresholdUsd;

    /// @dev Curve gets 75% of supply (real tokens transferred to pair), 25% reserved for LP
    uint256 public constant CURVE_BPS = 7500;
    uint256 public constant LP_RESERVE_BPS = 2500;
    uint256 public constant BPS_DENOM = 10_000;

    /// @dev Name/ticker length bounds. Hard-enforced at launch; webapp and API
    ///      replicate these limits. Changing them requires a contract redeploy.
    ///      `34` / `10` mirror Pump.fun's caps so tokens render consistently in
    ///      cross-launchpad aggregators (DEXScreener, Birdeye, etc.) which size
    ///      their UI off the longest name they've ever indexed.
    uint256 public constant MIN_NAME_LENGTH = 1;
    uint256 public constant MAX_NAME_LENGTH = 34;
    uint256 public constant MIN_TICKER_LENGTH = 1;
    uint256 public constant MAX_TICKER_LENGTH = 10;

    /// @dev Upper bounds on the optional metadata fields in `LaunchParams`.
    ///      These exist purely as DoS guards — without them a misbehaving
    ///      caller could push a multi-MB string into the launch tx and
    ///      bloat block space / indexer memory. Generous enough that real
    ///      tokens (rich descriptions, long URLs) are unaffected; sized off
    ///      the API's serialised body limits and what reasonable URL
    ///      shorteners produce. Off-chain (frontend, API) replicates these
    ///      pre-flight so users get a clean validation error instead of a
    ///      revert.
    uint256 public constant MAX_DESCRIPTION_LENGTH = 8000;
    uint256 public constant MAX_IMAGE_LENGTH = 512;
    uint256 public constant MAX_URL_LENGTH = 512;

    /// @notice Required low-order suffix on every launched token's address.
    ///         Every clone must end in `0xa1fa` (4 hex chars). The frontend
    ///         mines a CREATE2 salt that produces a qualifying address (~65k
    ///         attempts, <300 ms in a Web Worker pool); the contract enforces
    ///         the suffix as a backstop so launches are guaranteed-consistent
    ///         and no random fallback can sneak through.
    /// @dev    Must stay in sync with `VANITY_SUFFIX` in
    ///         `packages/shared/src/vanity.ts` (frontend miner) — diverging
    ///         the two would brick token creation.
    bytes2 public constant VANITY_SUFFIX = 0xa1fa;

    /// @notice Lifecycle of a launched token. Three mutually-exclusive states; the
    ///         enum is the single source of truth (replaces the old `trading` /
    ///         `graduated` boolean pair). Transitions are strictly forward:
    ///         `Curve → Graduating → Graduated`.
    enum Lifecycle {
        Curve, // default — trading on the bonding curve
        Graduating, // phase 1 done; awaiting `finalizeGraduation`
        Graduated // LP seeded on HyperSwap, locked, post-grad trading
    }

    struct TokenInfo {
        address creator;
        address token;
        address pair;
        address ltAddress;
        string name;
        string ticker;
        string description;
        string image;
        string[4] urls;
        Lifecycle lifecycle;
    }

    /// @notice Snapshot of LP-bound amounts cached at the end of phase 1, consumed
    ///         by `finalizeGraduation`, deleted on success.
    /// @dev    All amount fields are stored as `uint256`. `tokensForLP`,
    ///         `lpBurned`, and `unsoldBurned` are mathematically bounded by
    ///         `LP_RESERVE` / `curveSupply` (both < 2^90), but `ltFromPair`
    ///         depends on the LT's `exchangeRate()` at launch and at
    ///         graduation. Token creation is permissionless on
    ///         `Zap.createToken`, so a token paired with a malicious LT
    ///         returning a tiny `exchangeRate` could legitimately produce an
    ///         `ltFromPair` > 2^128. Storing as `uint256` removes any
    ///         narrowing-cast footgun (a truncated `ltFromPair` would strand
    ///         real LT in `Bonding` during phase 2). The extra storage slots
    ///         cost ~40k gas in phase 1, which is negligible against phase
    ///         2's ~2.5M baseline.
    ///         `pendingSince` is exposed so off-chain consumers (frontend
    ///         banner, keeper) can show "graduating for Xs" / escalate stale
    ///         entries without a separate block lookup.
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
        string[4] urls;
        address ltAddress;
        /// @dev User-supplied vanity salt for CREATE2 clone deployment. Mixed
        ///      with the creator address (`_mixSalt`) before being passed to
        ///      `Clones.cloneDeterministic`, so two creators using the same
        ///      `userSalt` cannot collide and a mined salt cannot be
        ///      front-run by another launcher.
        bytes32 salt;
    }

    mapping(address => TokenInfo) internal _tokenInfo;
    address[] public allTokens;
    mapping(address => address[]) public creatorTokens;

    /// @dev LP reserve tokens held per token for graduation
    mapping(address => uint256) public lpReserve;
    /// @dev HyperSwap V2 pair created at graduation
    mapping(address => address) public graduatedPair;
    /// @notice Per-token state cached during phase 1, consumed by `finalizeGraduation`.
    ///         Empty (`pendingSince == 0`) for tokens not in the `Graduating` phase.
    mapping(address => PendingGraduation) public pendingGraduation;

    /// @dev Storage gap for future upgrades. Sized so this contract's storage block
    ///      totals 50 slots (15 named + 35 gap). Append new state variables before
    ///      this gap and shrink its length to match.
    uint256[35] private __gap;

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        address ltAddress,
        string name,
        string ticker,
        uint256 k,
        uint256 index
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 ltAmount,
        uint256 tokenAmount,
        uint256 newCurveSupply,
        uint256 newLtReserve
    );
    /// @notice Phase 1 of graduation has fired. Trading is frozen; `finalizeGraduation`
    ///         is now callable (permissionlessly) to seed the HyperSwap LP. The
    ///         indexer surfaces this to the frontend as the `Graduating` state.
    event TokenGraduating(
        address indexed token, uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned
    );
    event TokenGraduated(
        address indexed token,
        address pairAddress,
        uint256 liquidity,
        uint256 tokensInLP,
        uint256 lpBurned,
        uint256 unsoldBurned
    );
    event CreatorTransferred(address indexed token, address indexed oldCreator, address indexed newCreator);
    event RouterAdded(address indexed router);
    event RouterRemoved(address indexed router);
    event GraduationThresholdUpdated(uint256 oldValue, uint256 newValue);
    event TokenImplementationUpdated(address indexed oldImpl, address indexed newImpl);

    error TokenNotTrading();
    /// @dev Raised by `Zap` (and callable views) when a buy/sell hits a token in
    ///      the `Graduating` phase — distinct from `TokenNotTrading` so the UI
    ///      can show the "Token is graduating" overlay rather than a generic
    ///      error.
    error TokenIsGraduating();
    /// @dev `finalizeGraduation` was called on a token that's not in phase 1.
    error NotGraduating();
    error ZeroAddress();
    error TokenAlreadyGraduated();
    error InvalidInput();
    error SlippageExceeded();
    error NotCreator();
    error NotRouter();
    error RouterAlreadyAdded();
    error RouterNotFound();
    error ZeroExchangeRate();
    error InvalidNameLength();
    error InvalidTickerLength();
    error InvalidDescriptionLength();
    error InvalidImageLength();
    error InvalidUrlLength();
    error InvalidThreshold();
    /// @dev Thrown when a launch's CREATE2 salt resolves to an address that
    ///      doesn't end in `VANITY_SUFFIX`. This is the on-chain backstop
    ///      enforcing the "every launched token has an `a1fa` suffix"
    ///      product invariant — the frontend miner must always produce a
    ///      qualifying salt (no random fallbacks).
    error NotVanityAddress(address tokenAddr);

    modifier onlyRouter() {
        if (!_routers.contains(msg.sender)) revert NotRouter();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address router_,
        uint256 maxTx_,
        address hyperswapRouter_,
        address lpLock_,
        address tokenImplementation_
    ) external initializer {
        if (tokenImplementation_ == address(0)) revert ZeroAddress();
        __Ownable_init(msg.sender);

        factory = Factory(factory_);
        router = Router(router_);
        maxTx = maxTx_;
        hyperswapRouter = hyperswapRouter_;
        lpLock = lpLock_;
        tokenImplementation = tokenImplementation_;
        graduationThresholdUsd = DEFAULT_GRADUATION_THRESHOLD_USD;
    }

    // ─── Launch ──────────────────────────────────────────────────────────

    function launch(
        LaunchParams calldata params,
        address creator_
    ) external onlyRouter nonReentrant returns (address tokenAddr, address pair, uint256 index) {
        if (params.ltAddress == address(0)) revert InvalidInput();

        uint256 nameLen = bytes(params.name).length;
        if (nameLen < MIN_NAME_LENGTH || nameLen > MAX_NAME_LENGTH) revert InvalidNameLength();
        uint256 tickerLen = bytes(params.ticker).length;
        if (tickerLen < MIN_TICKER_LENGTH || tickerLen > MAX_TICKER_LENGTH) revert InvalidTickerLength();
        if (bytes(params.description).length > MAX_DESCRIPTION_LENGTH) revert InvalidDescriptionLength();
        if (bytes(params.image).length > MAX_IMAGE_LENGTH) revert InvalidImageLength();
        // Per-URL cap (no minimum — empty URLs are valid). Cheaper than a
        // total-cap loop and aligns with the per-field semantics off-chain.
        for (uint256 i = 0; i < 4; i++) {
            if (bytes(params.urls[i]).length > MAX_URL_LENGTH) revert InvalidUrlLength();
        }

        (tokenAddr, pair) = _deployAndSeed(params.name, params.ticker, params.ltAddress, creator_, params.salt);
        index = allTokens.length;
        _storeTokenInfo(tokenAddr, pair, params, creator_);

        uint256 k = IPair(pair).kLast();
        emit TokenLaunched(tokenAddr, creator_, params.ltAddress, params.name, params.ticker, k, index);
    }

    function _deployAndSeed(
        string calldata name_,
        string calldata ticker_,
        address ltAddress,
        address creator_,
        bytes32 userSalt
    ) internal returns (address tokenAddr, address pair) {
        // EIP-1167 clone of `tokenImplementation`. `Clones.cloneDeterministic`
        // reverts with `ERC1167FailedCreateClone` on address collision; the
        // creator-mixed salt makes that astronomically unlikely.
        tokenAddr = Clones.cloneDeterministic(tokenImplementation, _mixSalt(creator_, userSalt));

        // Enforce the vanity suffix invariant. The frontend mines a salt
        // off-chain so this should always pass for legitimate launches; we
        // check on-chain anyway so a misbehaving client (or any future
        // alternative router) can't bypass it. The truncating cast is
        // deliberate — we *want* only the last 2 bytes of the address.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (bytes2(uint16(uint160(tokenAddr))) != VANITY_SUFFIX) {
            revert NotVanityAddress(tokenAddr);
        }

        Token(tokenAddr).initialize(name_, ticker_, maxTx, address(this));

        uint256 totalSupply = Token(tokenAddr).TOTAL_SUPPLY();
        uint256 curveSupply = (totalSupply * CURVE_BPS) / BPS_DENOM;

        pair = factory.createPair(tokenAddr, ltAddress);

        uint256 exchangeRate = ILeveragedToken(ltAddress).exchangeRate();
        if (exchangeRate == 0) revert ZeroExchangeRate();
        uint256 virtualLtReserve = (VIRTUAL_LIQUIDITY_USD * 1e18) / exchangeRate;

        IERC20(tokenAddr).forceApprove(address(router), curveSupply);
        // Virtual reserve0 = full totalSupply; only curveSupply (75%) is actually transferred.
        router.addInitialLiquidity(tokenAddr, totalSupply, curveSupply, virtualLtReserve);

        lpReserve[tokenAddr] = totalSupply - curveSupply;
    }

    /// @notice Predict the clone address for `(creator_, userSalt)`. Mirrors
    ///         the address that `launch()` would deploy, without state changes.
    ///         Used by the frontend vanity-mining UI to (a) pre-display the
    ///         address before the user signs the launch tx and (b) verify
    ///         on-chain that a mined salt still resolves to the expected
    ///         address (e.g. after an impl rotation).
    function predictTokenAddress(
        address creator_,
        bytes32 userSalt
    ) external view returns (address) {
        return Clones.predictDeterministicAddress(tokenImplementation, _mixSalt(creator_, userSalt), address(this));
    }

    /// @dev Combine the creator address into the user-supplied salt so that:
    ///      1. Two creators using the same `userSalt` deploy to different
    ///         addresses (no accidental collision).
    ///      2. A mined `userSalt` cannot be front-run by another launcher —
    ///         their tx would resolve to a different clone address.
    function _mixSalt(
        address creator_,
        bytes32 userSalt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator_, userSalt));
    }

    function _storeTokenInfo(
        address tokenAddr,
        address pair,
        LaunchParams calldata params,
        address creator_
    ) internal {
        _tokenInfo[tokenAddr] = TokenInfo({
            creator: creator_,
            token: tokenAddr,
            pair: pair,
            ltAddress: params.ltAddress,
            name: params.name,
            ticker: params.ticker,
            description: params.description,
            image: params.image,
            urls: params.urls,
            lifecycle: Lifecycle.Curve
        });
        allTokens.push(tokenAddr);
        creatorTokens[creator_].push(tokenAddr);
    }

    // ─── Buy / Sell ──────────────────────────────────────────────────────

    /// @notice Buy tokens on the curve. Router-only.
    /// @param amountIn      Max LT the caller permits to be pulled.
    /// @param tokenAddress  Token to buy.
    /// @param amountOutMin  Minimum tokens out (slippage check).
    /// @param trader        The ultimate user attributed in the emitted `Trade`
    ///                      event. The calling router passes its own caller
    ///                      (`msg.sender` at the router level) — trusted because
    ///                      only allowlisted routers can reach this function.
    /// @return tokensOut    Tokens delivered to the calling router (which then
    ///                      forwards them to the user).
    /// @return amountInUsed LT actually consumed (≤ amountIn). Any difference remains in caller.
    function buy(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        address trader
    ) external onlyRouter nonReentrant returns (uint256 tokensOut, uint256 amountInUsed) {
        TokenInfo storage info = _tokenInfo[tokenAddress];
        // Existence check. `Lifecycle.Curve` is the zero value, so an
        // unwritten slot (unknown token) would otherwise pass the lifecycle
        // gate and fall through into `router.buy`, which would revert deep
        // in `IPair(address(0))` with a cryptic low-level error.
        // `_storeTokenInfo` always sets `info.token`, so a zero here means
        // "address never registered as a launched token".
        if (info.token == address(0)) revert TokenNotTrading();
        if (info.lifecycle == Lifecycle.Graduating) revert TokenIsGraduating();
        if (info.lifecycle != Lifecycle.Curve) revert TokenNotTrading();

        // `msg.sender` (the router) holds LT and receives tokens; `trader` is the
        // user whose identity is recorded in the `Trade` event.
        (tokensOut, amountInUsed) = _executeBuy(msg.sender, trader, amountIn, tokenAddress);
        if (tokensOut < amountOutMin) revert SlippageExceeded();
    }

    /// @notice Sell tokens on the curve. Router-only.
    /// @param trader The ultimate user attributed in the emitted `Trade` event.
    function sell(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        address trader
    ) external onlyRouter nonReentrant returns (uint256) {
        TokenInfo storage info = _tokenInfo[tokenAddress];
        // Existence check — see `buy` for the rationale.
        if (info.token == address(0)) revert TokenNotTrading();
        if (info.lifecycle == Lifecycle.Graduating) revert TokenIsGraduating();
        if (info.lifecycle != Lifecycle.Curve) revert TokenNotTrading();

        // Router holds the tokens and receives LT (`msg.sender` here = router).
        // `trader` is purely informational — emitted in the `Trade` event.
        (, uint256 assetOut) = router.sell(amountIn, tokenAddress, msg.sender);
        if (assetOut < amountOutMin) revert SlippageExceeded();

        (uint256 newCurveSupply, uint256 newLtReserve) = _getCurveState(tokenAddress);
        emit Trade(tokenAddress, trader, false, assetOut, amountIn, newCurveSupply, newLtReserve);
        return assetOut;
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function tokenInfo(
        address token_
    )
        external
        view
        returns (
            address creator,
            address token,
            address pair,
            address ltAddress,
            string memory name_,
            string memory ticker,
            Lifecycle lifecycle
        )
    {
        TokenInfo storage info = _tokenInfo[token_];
        return (info.creator, info.token, info.pair, info.ltAddress, info.name, info.ticker, info.lifecycle);
    }

    function getTokenInfo(
        address token_
    ) external view returns (TokenInfo memory) {
        return _tokenInfo[token_];
    }

    /// @notice Lightweight creator lookup. Hot-path callers (e.g. `Zap`'s
    ///         per-trade fee accrual) should use this instead of `getTokenInfo` /
    ///         `tokenInfo` to avoid ABI-copying the dynamic strings & URL array.
    function creatorOf(
        address token_
    ) external view returns (address) {
        return _tokenInfo[token_].creator;
    }

    /// @notice True iff the token is in the active bonding-curve phase. Buys
    ///         and sells are only accepted in this state.
    function isTrading(
        address token_
    ) external view returns (bool) {
        return _tokenInfo[token_].lifecycle == Lifecycle.Curve;
    }

    /// @notice True iff phase 1 has fired but `finalizeGraduation` has not yet
    ///         seeded the HyperSwap LP. Buys and sells revert with
    ///         `TokenIsGraduating` during this window.
    function isGraduating(
        address token_
    ) external view returns (bool) {
        return _tokenInfo[token_].lifecycle == Lifecycle.Graduating;
    }

    function isGraduated(
        address token_
    ) external view returns (bool) {
        return _tokenInfo[token_].lifecycle == Lifecycle.Graduated;
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice Dual-trigger graduation check.
    ///         USD trigger: real LT reserve * exchangeRate >= `graduationThresholdUsd`.
    ///         Supply trigger: all curve tokens sold (pair real token balance == 0).
    function canGraduate(
        address token_
    ) public view returns (bool) {
        if (_tokenInfo[token_].lifecycle != Lifecycle.Curve) return false;
        address pair = _tokenInfo[token_].pair;
        address lt = _tokenInfo[token_].ltAddress;

        // Supply trigger: no real tokens left in the pair
        if (IPair(pair).tokenBalance() == 0) return true;

        // USD trigger
        uint256 realLtBalance = IPair(pair).assetBalance();
        uint256 exchangeRate = ILeveragedToken(lt).exchangeRate();
        uint256 valueUsd = (realLtBalance * exchangeRate) / 1e18;
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

    function setMaxTx(
        uint256 newMaxTx
    ) external onlyOwner {
        maxTx = newMaxTx;
    }

    function setHyperswap(
        address newRouter,
        address newLpLock
    ) external onlyOwner {
        hyperswapRouter = newRouter;
        lpLock = newLpLock;
    }

    /// @notice Hot-swap the `Token` implementation cloned by future launches.
    /// @dev Already-deployed clones are unaffected — EIP-1167 hard-codes the
    ///      impl address into the proxy bytecode at deploy time, so existing
    ///      tokens keep delegating into whichever impl was current when they
    ///      were launched. Use this for shipping a new `Token` (e.g. bug fix
    ///      surfaces in the impl) without disturbing already-issued tokens.
    function setTokenImplementation(
        address newImpl
    ) external onlyOwner {
        if (newImpl == address(0)) revert ZeroAddress();
        address old = tokenImplementation;
        tokenImplementation = newImpl;
        emit TokenImplementationUpdated(old, newImpl);
    }

    /// @notice Update the global graduation threshold (18-dp USD).
    /// @dev Applies to ALL currently-trading tokens — the new value is read
    ///      on the next `buy`/`sell` via `canGraduate`. Tokens whose real LT
    ///      reserve already values above the new threshold will graduate on
    ///      their next trade. Bounded by `MIN_GRADUATION_THRESHOLD_USD` (so
    ///      a freshly-launched curve can't be pre-graduated) and
    ///      `MAX_GRADUATION_THRESHOLD_USD` (defensive fat-finger guard).
    function setGraduationThresholdUsd(
        uint256 newValue
    ) external onlyOwner {
        if (newValue < MIN_GRADUATION_THRESHOLD_USD || newValue > MAX_GRADUATION_THRESHOLD_USD) {
            revert InvalidThreshold();
        }
        uint256 old = graduationThresholdUsd;
        graduationThresholdUsd = newValue;
        emit GraduationThresholdUpdated(old, newValue);
    }

    /// @notice Authorise a router to call `launch`, `buy`, and `sell`. Multiple
    ///         routers may be active simultaneously. Reverts if `router` is
    ///         zero or already allowlisted.
    function addRouter(
        address router_
    ) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        if (!_routers.add(router_)) revert RouterAlreadyAdded();
        emit RouterAdded(router_);
    }

    /// @notice Revoke a router's authorisation. Reverts if not previously
    ///         allowlisted.
    function removeRouter(
        address router_
    ) external onlyOwner {
        if (!_routers.remove(router_)) revert RouterNotFound();
        emit RouterRemoved(router_);
    }

    /// @notice Check whether an address is an authorised router.
    function isRouter(
        address router_
    ) external view returns (bool) {
        return _routers.contains(router_);
    }

    /// @notice Enumerate all currently-authorised routers. Intended for admin
    ///         tooling / off-chain introspection; on-chain callers should
    ///         prefer `isRouter` for O(1) membership checks.
    function getRouters() external view returns (address[] memory) {
        return _routers.values();
    }

    // ─── Internals ───────────────────────────────────────────────────────

    /// @dev `tokenHolder` is the address `Router` pulls LT from and delivers
    ///      tokens to — always the calling `Zap` (which then forwards
    ///      tokens to the user). `trader` is the event-only attribution
    ///      (the user EOA) and has no effect on token flow.
    function _executeBuy(
        address tokenHolder,
        address trader,
        uint256 amountIn,
        address tokenAddress
    ) internal returns (uint256 tokensOut, uint256 amountInUsed) {
        (amountInUsed, tokensOut) = router.buy(amountIn, tokenAddress, tokenHolder);

        (uint256 newCurveSupply, uint256 newLtReserve) = _getCurveState(tokenAddress);
        emit Trade(tokenAddress, trader, true, amountInUsed, tokensOut, newCurveSupply, newLtReserve);

        // `canGraduate` already gates on `lifecycle == Curve`, so no extra check needed here.
        if (canGraduate(tokenAddress)) {
            _enterGraduating(tokenAddress);
        }
    }

    /// @dev Phase 1 of graduation. Runs inline at the end of the threshold-crossing
    ///      buy. Cheap (~150-200k of additional gas on top of the buy) so the
    ///      whole tx still fits in HyperEVM's small block. Phase 2 is the
    ///      separate `finalizeGraduation` call.
    function _enterGraduating(
        address tokenAddress
    ) internal {
        TokenInfo storage info = _tokenInfo[tokenAddress];
        if (info.lifecycle != Lifecycle.Curve) revert TokenAlreadyGraduated();

        info.lifecycle = Lifecycle.Graduating;

        // Drain curve, compute dynamic-LP-seeding amounts, burn excess. The
        // `tokensForLP` and `ltFromPair` are pinned NOW (at the last curve
        // price) and used verbatim in phase 2 — that's how we keep the
        // zero-gap invariant despite the tx split.
        (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) =
            _prepareGraduationLiquidity(tokenAddress);

        // Amounts are stored full-width (`uint256`) — see `PendingGraduation`
        // natspec for why narrowing casts on `ltFromPair` aren't safe in the
        // presence of malicious LTs. `pendingSince` truncates a Unix
        // timestamp (seconds) to `uint64`, which doesn't overflow until year
        // ~584 billion AD.
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

    /// @notice Phase 2 of graduation: seed the HyperSwap LP with the amounts
    ///         cached in phase 1 and lock the LP tokens. **Permissionless** —
    ///         a Cloudflare Worker keeper handles the happy path; anyone can
    ///         call to rescue a token whose keeper missed it.
    /// @dev The LP-seeding path bypasses the HyperSwap V2 router and calls
    ///      `pair.mint(lpLock)` directly. This is brick-proof: even if a
    ///      front-runner pre-creates the pair *and* deposits dust to set
    ///      reserves > 0 in the window between phase 1 and phase 2, this
    ///      function still succeeds (the front-runner just costs themselves
    ///      gas + a small price haircut that arbitrageurs close out post-grad).
    ///      Compare with the deleted `_requirePairEmpty` path which would
    ///      have permanently bricked finalize in that scenario.
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

    /// @dev Burns unsold curve tokens, drains LT from the pair, computes the exact
    ///      `tokensForLP` needed to match the last curve price, and burns the LP excess.
    ///
    ///      Price equality: `tokensForLP / ltFromPair = reserve0 / reserve1 = lastPrice`.
    ///      By construction (V_t_init = totalSupply, curveSupply = 75%), the parabola
    ///         tokensForLP(sold) = sold · (S − sold) / S
    ///      peaks at S/4 = LP_RESERVE when sold = S/2, so `tokensForLP ≤ lpReserveTotal`
    ///      is a mathematical invariant. The cap is a defensive guard.
    function _prepareGraduationLiquidity(
        address tokenAddress
    ) internal returns (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) {
        address pairAddr = _tokenInfo[tokenAddress].pair;
        (uint256 reserve0, uint256 reserve1) = IPair(pairAddr).getReserves();

        unsoldBurned = IERC20(tokenAddress).balanceOf(pairAddr);
        if (unsoldBurned > 0) {
            Token(tokenAddress).burn(pairAddr, unsoldBurned);
        }

        ltFromPair = router.graduate(tokenAddress);

        uint256 lpReserveTotal = lpReserve[tokenAddress];
        tokensForLP = reserve1 == 0 ? 0 : (ltFromPair * reserve0) / reserve1;
        if (tokensForLP > lpReserveTotal) tokensForLP = lpReserveTotal;

        lpBurned = lpReserveTotal - tokensForLP;
        if (lpBurned > 0) {
            Token(tokenAddress).burn(address(this), lpBurned);
        }
        lpReserve[tokenAddress] = 0;
    }

    /// @dev Idempotent: returns the existing HyperSwap pair if one is already
    ///      registered, otherwise creates it. Either branch leaves the pair
    ///      ready for `_seedHyperswapDirect` to mint LP into.
    function _ensureHyperswapPair(
        address tokenA,
        address tokenB
    ) internal returns (address pair) {
        IUniswapV2Factory hsFactory = IUniswapV2Factory(IUniswapV2Router02(hyperswapRouter).factory());
        pair = hsFactory.getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = hsFactory.createPair(tokenA, tokenB);
        }
    }

    /// @dev Standard UniswapV2 `transfer → mint` pattern. We bypass the V2
    ///      router (no slippage path / `amountAMin` to bind) so a front-runner
    ///      who pre-seeds reserves can never brick this call. The downside —
    ///      LP minted at a slightly skewed ratio — is bounded by what the
    ///      front-runner is willing to lock, and arbitrageurs close it out
    ///      post-grad. This is the same direct-to-pair pattern `Zap` uses for
    ///      its post-grad swaps.
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
