// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {FFactory} from "./FFactory.sol";
import {FRouter} from "./FRouter.sol";
import {FERC20} from "./FERC20.sol";
import {IFPair} from "./interfaces/IFPair.sol";
import {ILeveragedToken} from "./interfaces/ILeveragedToken.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
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
contract Bonding is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    FFactory public factory;
    FRouter public router;

    address public hyperswapRouter;
    address public lpLock;

    /// @dev Authorised routers. Only addresses in this set may call `launch`,
    ///      `buy`, or `sell`. Managed via `addRouter` / `removeRouter`. The
    ///      set model (vs. a single `launchpadRouter` address) allows seamless
    ///      router upgrades: deploy the new router, `addRouter(newRouter)`,
    ///      flip the frontend's canonical address, then `removeRouter(old)`
    ///      with no window in which users can't trade.
    EnumerableSet.AddressSet private _routers;

    uint256 public maxTx;

    /// @dev Target virtual LT reserve in 18-decimal USD. Controls opening market cap.
    ///      Since virtual reserve0 = totalSupply (1B), opening MC = VIRTUAL_LIQUIDITY_USD.
    uint256 public constant VIRTUAL_LIQUIDITY_USD = 4000 ether;

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
    uint256 public constant MIN_NAME_LENGTH = 1;
    uint256 public constant MAX_NAME_LENGTH = 34;
    uint256 public constant MIN_TICKER_LENGTH = 1;
    uint256 public constant MAX_TICKER_LENGTH = 10;

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
        bool trading;
        bool graduated;
    }

    struct LaunchParams {
        string name;
        string ticker;
        string description;
        string image;
        string[4] urls;
        address ltAddress;
    }

    mapping(address => TokenInfo) internal _tokenInfo;
    address[] public allTokens;
    mapping(address => address[]) public creatorTokens;

    /// @dev LP reserve tokens held per token for graduation
    mapping(address => uint256) public lpReserve;
    /// @dev HyperSwap V2 pair created at graduation
    mapping(address => address) public graduatedPair;

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

    error TokenNotTrading();
    error ZeroAddress();
    error TokenAlreadyGraduated();
    error InvalidInput();
    error SlippageExceeded();
    error NotCreator();
    error NotRouter();
    error RouterAlreadyAdded();
    error RouterNotFound();
    error ZeroExchangeRate();
    error PairAlreadySeeded();
    error PairLookupFailed();
    error InvalidNameLength();
    error InvalidTickerLength();
    error InvalidThreshold();

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
        address lpLock_
    ) external initializer {
        __Ownable_init(msg.sender);

        factory = FFactory(factory_);
        router = FRouter(router_);
        maxTx = maxTx_;
        hyperswapRouter = hyperswapRouter_;
        lpLock = lpLock_;
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

        (tokenAddr, pair) = _deployAndSeed(params.name, params.ticker, params.ltAddress);
        index = allTokens.length;
        _storeTokenInfo(tokenAddr, pair, params, creator_);

        uint256 k = IFPair(pair).kLast();
        emit TokenLaunched(tokenAddr, creator_, params.ltAddress, params.name, params.ticker, k, index);
    }

    function _deployAndSeed(
        string calldata name_,
        string calldata ticker_,
        address ltAddress
    ) internal returns (address tokenAddr, address pair) {
        FERC20 token = new FERC20{salt: keccak256(abi.encodePacked(msg.sender, block.timestamp, allTokens.length))}(
            name_, ticker_, maxTx, address(this)
        );
        tokenAddr = address(token);
        uint256 totalSupply = token.totalSupply();
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
            trading: true,
            graduated: false
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
        if (!_tokenInfo[tokenAddress].trading) revert TokenNotTrading();

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
        if (!_tokenInfo[tokenAddress].trading) revert TokenNotTrading();

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
            bool trading,
            bool graduated
        )
    {
        TokenInfo storage info = _tokenInfo[token_];
        return
            (info.creator, info.token, info.pair, info.ltAddress, info.name, info.ticker, info.trading, info.graduated);
    }

    function getTokenInfo(
        address token_
    ) external view returns (TokenInfo memory) {
        return _tokenInfo[token_];
    }

    /// @notice Lightweight creator lookup. Hot-path callers (e.g. `LaunchpadRouter`'s
    ///         per-trade fee accrual) should use this instead of `getTokenInfo` /
    ///         `tokenInfo` to avoid ABI-copying the dynamic strings & URL array.
    function creatorOf(
        address token_
    ) external view returns (address) {
        return _tokenInfo[token_].creator;
    }

    function isTrading(
        address token_
    ) external view returns (bool) {
        return _tokenInfo[token_].trading;
    }

    function isGraduated(
        address token_
    ) external view returns (bool) {
        return _tokenInfo[token_].graduated;
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
        if (!_tokenInfo[token_].trading || _tokenInfo[token_].graduated) return false;
        address pair = _tokenInfo[token_].pair;
        address lt = _tokenInfo[token_].ltAddress;

        // Supply trigger: no real tokens left in the pair
        if (IFPair(pair).tokenBalance() == 0) return true;

        // USD trigger
        uint256 realLtBalance = IFPair(pair).assetBalance();
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

    /// @dev `tokenHolder` is the address FRouter pulls LT from and delivers
    ///      tokens to — always the calling LaunchpadRouter (which then forwards
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

        if (_tokenInfo[tokenAddress].trading && canGraduate(tokenAddress)) {
            _graduate(tokenAddress);
        }
    }

    function _graduate(
        address tokenAddress
    ) internal {
        TokenInfo storage info = _tokenInfo[tokenAddress];
        if (info.graduated || !info.trading) revert TokenAlreadyGraduated();

        info.trading = false;
        info.graduated = true;

        address lt = info.ltAddress;

        // Drain curve, align price via dynamic LP seeding, burn excess.
        (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) =
            _prepareGraduationLiquidity(tokenAddress);

        _requirePairEmpty(tokenAddress, lt);

        uint256 liquidity = _seedHyperswap(tokenAddress, lt, tokensForLP, ltFromPair);

        address hyperPair = _getHyperswapPair(tokenAddress, lt);
        graduatedPair[tokenAddress] = hyperPair;

        LPLock(lpLock).recordLock(tokenAddress, hyperPair, liquidity);

        emit TokenGraduated(tokenAddress, hyperPair, liquidity, tokensForLP, lpBurned, unsoldBurned);
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
        (uint256 reserve0, uint256 reserve1) = IFPair(pairAddr).getReserves();

        unsoldBurned = IERC20(tokenAddress).balanceOf(pairAddr);
        if (unsoldBurned > 0) {
            FERC20(tokenAddress).burn(pairAddr, unsoldBurned);
        }

        ltFromPair = router.graduate(tokenAddress);

        uint256 lpReserveTotal = lpReserve[tokenAddress];
        tokensForLP = reserve1 == 0 ? 0 : (ltFromPair * reserve0) / reserve1;
        if (tokensForLP > lpReserveTotal) tokensForLP = lpReserveTotal;

        lpBurned = lpReserveTotal - tokensForLP;
        if (lpBurned > 0) {
            FERC20(tokenAddress).burn(address(this), lpBurned);
        }
        lpReserve[tokenAddress] = 0;
    }

    function _seedHyperswap(
        address tokenAddress,
        address lt,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) internal returns (uint256 liquidity) {
        IERC20(tokenAddress).forceApprove(hyperswapRouter, tokensForLP);
        IERC20(lt).forceApprove(hyperswapRouter, ltFromPair);

        (,, liquidity) = IUniswapV2Router02(hyperswapRouter)
            .addLiquidity(
                tokenAddress,
                lt,
                tokensForLP,
                ltFromPair,
                (tokensForLP * 99) / 100,
                (ltFromPair * 99) / 100,
                lpLock,
                block.timestamp
            );
    }

    function _getCurveState(
        address tokenAddress
    ) internal view returns (uint256 curveSupply, uint256 ltReserve) {
        address pair = _tokenInfo[tokenAddress].pair;
        (curveSupply, ltReserve) = IFPair(pair).getReserves();
    }

    /// @dev Reverts if the HyperSwap pair already has reserves (prevents front-running graduation)
    function _requirePairEmpty(
        address tokenA,
        address tokenB
    ) internal view {
        address hsFactory = IUniswapV2Router02(hyperswapRouter).factory();
        (bool pairOk, bytes memory pairData) =
            hsFactory.staticcall(abi.encodeWithSignature("getPair(address,address)", tokenA, tokenB));
        if (pairOk && pairData.length >= 32) {
            address existingPair = abi.decode(pairData, (address));
            if (existingPair != address(0)) {
                (bool resOk, bytes memory resData) = existingPair.staticcall(abi.encodeWithSignature("getReserves()"));
                if (resOk && resData.length >= 64) {
                    (uint112 r0, uint112 r1,) = abi.decode(resData, (uint112, uint112, uint32));
                    if (r0 > 0 || r1 > 0) revert PairAlreadySeeded();
                }
            }
        }
    }

    function _getHyperswapPair(
        address tokenA,
        address tokenB
    ) internal view returns (address) {
        address hsFactory = IUniswapV2Router02(hyperswapRouter).factory();
        // Use staticcall to IUniswapV2Factory.getPair
        (bool ok, bytes memory data) =
            hsFactory.staticcall(abi.encodeWithSignature("getPair(address,address)", tokenA, tokenB));
        if (!ok || data.length < 32) revert PairLookupFailed();
        return abi.decode(data, (address));
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
