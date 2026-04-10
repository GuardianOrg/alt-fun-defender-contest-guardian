// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FFactory} from "./FFactory.sol";
import {FRouter} from "./FRouter.sol";
import {FERC20} from "./FERC20.sol";
import {IFPair} from "./interfaces/IFPair.sol";
import {ILeveragedToken} from "./interfaces/ILeveragedToken.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {LPLock} from "./LPLock.sol";

/// @title Bonding
/// @notice Constant-product bonding curve for the memecoin launchpad.
/// @dev Each token pairs with a BounceTech Leveraged Token (LT). K is computed per-token
///      from the LT's exchange rate so every token opens at ~$4K market cap.
///      Graduation triggers when LT_reserves * exchangeRate >= $12K.
///      Upon graduation, unsold tokens are burned and a MEMECOIN/LT pool is seeded on HyperSwap V2.
contract Bonding is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    FFactory public factory;
    FRouter public router;
    address public feeTo;

    address public hyperswapRouter;
    address public lpLock;

    uint256 public maxTx;

    /// @dev Target virtual LT reserve in 18-decimal USD. Controls opening market cap.
    ///      With 75% on curve: opening MC ≈ VIRTUAL_LIQUIDITY_USD * totalSupply / curveSupply
    uint256 public constant VIRTUAL_LIQUIDITY_USD = 3000 ether;

    /// @dev Graduation fires when real LT reserve * exchangeRate >= this value (18-decimal USD)
    uint256 public constant GRADUATION_THRESHOLD_USD = 12_000 ether;

    /// @dev Curve gets 75% of supply, 25% reserved for graduation LP
    uint256 public constant CURVE_BPS = 7500;
    uint256 public constant LP_RESERVE_BPS = 2500;
    uint256 public constant BPS_DENOM = 10_000;

    /// @dev Creator gets 20% of trade fees (0.1% of 0.5%)
    uint256 public constant CREATOR_FEE_BPS = 2000;

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
        uint256 purchaseAmount; // LT amount for seed buy (0 = no seed buy)
    }

    mapping(address => TokenInfo) internal _tokenInfo;
    address[] public allTokens;
    mapping(address => address[]) public creatorTokens;

    /// @dev LP reserve tokens held per memecoin for graduation
    mapping(address => uint256) public lpReserve;
    /// @dev HyperSwap V2 pair created at graduation
    mapping(address => address) public graduatedPair;

    /// @dev Creator fee accrual: creator => LT => amount
    mapping(address => mapping(address => uint256)) public creatorFees;
    /// @dev Protocol fee accrual: LT => amount
    mapping(address => uint256) public protocolFees;

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
    event TokenGraduated(address indexed token, address pairAddress, uint256 liquidity);
    event Referred(address indexed token, address indexed trader, address indexed referrer, uint256 ltAmount);
    event CreatorFeesClaimed(address indexed creator, address indexed lt, uint256 amount);
    event ProtocolFeesClaimed(address indexed lt, uint256 amount);
    event CreatorTransferred(address indexed token, address indexed oldCreator, address indexed newCreator);

    error TokenNotTrading();
    error TokenAlreadyGraduated();
    error InvalidInput();
    error SlippageExceeded();
    error DeadlineExpired();
    error NothingToClaim();
    error NotCreator();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address router_,
        address feeTo_,
        uint256 maxTx_,
        address hyperswapRouter_,
        address lpLock_
    ) external initializer {
        __Ownable_init(msg.sender);

        factory = FFactory(factory_);
        router = FRouter(router_);
        feeTo = feeTo_;
        maxTx = maxTx_;
        hyperswapRouter = hyperswapRouter_;
        lpLock = lpLock_;
    }

    // ─── Launch ──────────────────────────────────────────────────────────

    function launch(
        LaunchParams calldata params,
        address creator_
    ) external nonReentrant returns (address tokenAddr, address pair, uint256 index) {
        if (params.ltAddress == address(0)) revert InvalidInput();

        (tokenAddr, pair) = _deployAndSeed(params.name, params.ticker, params.ltAddress);
        _storeTokenInfo(tokenAddr, pair, params, creator_);

        uint256 k = IFPair(pair).kLast();
        index = allTokens.length;
        emit TokenLaunched(tokenAddr, creator_, params.ltAddress, params.name, params.ticker, k, index);

        if (params.purchaseAmount > 0) {
            _seedBuy(tokenAddr, params.ltAddress, params.purchaseAmount, creator_);
        }
    }

    function _deployAndSeed(
        string calldata name_,
        string calldata ticker_,
        address ltAddress
    ) internal returns (address tokenAddr, address pair) {
        FERC20 token = new FERC20{salt: keccak256(abi.encodePacked(msg.sender, block.timestamp))}(
            string.concat("fun ", name_), ticker_, maxTx, address(this)
        );
        tokenAddr = address(token);
        uint256 totalSupply = token.totalSupply();
        uint256 curveSupply = (totalSupply * CURVE_BPS) / BPS_DENOM;

        pair = factory.createPair(tokenAddr, ltAddress);

        uint256 exchangeRate = ILeveragedToken(ltAddress).exchangeRate();
        uint256 virtualLtReserve = (VIRTUAL_LIQUIDITY_USD * 1e18) / exchangeRate;

        IERC20(tokenAddr).forceApprove(address(router), curveSupply);
        router.addInitialLiquidity(tokenAddr, curveSupply, virtualLtReserve);

        lpReserve[tokenAddr] = totalSupply - curveSupply;
    }

    function _seedBuy(
        address tokenAddr,
        address ltAddress,
        uint256 purchaseAmount,
        address creator_
    ) internal {
        IERC20(ltAddress).safeTransferFrom(msg.sender, address(this), purchaseAmount);
        IERC20(ltAddress).forceApprove(address(router), purchaseAmount);

        uint256 balBefore = IERC20(tokenAddr).balanceOf(address(this));
        _executeBuy(address(this), purchaseAmount, tokenAddr);
        uint256 seedTokens = IERC20(tokenAddr).balanceOf(address(this)) - balBefore;

        IERC20(tokenAddr).safeTransfer(creator_, seedTokens);
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

    function buy(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        uint256 deadline
    ) external nonReentrant returns (uint256) {
        if (!_tokenInfo[tokenAddress].trading) revert TokenNotTrading();
        if (block.timestamp > deadline) revert DeadlineExpired();

        uint256 tokensOut = _executeBuy(msg.sender, amountIn, tokenAddress);
        if (tokensOut < amountOutMin) revert SlippageExceeded();
        return tokensOut;
    }

    function sell(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        uint256 deadline
    ) external nonReentrant returns (uint256) {
        if (!_tokenInfo[tokenAddress].trading) revert TokenNotTrading();
        if (block.timestamp > deadline) revert DeadlineExpired();

        (, uint256 netAssetOut) = router.sell(amountIn, tokenAddress, msg.sender);
        if (netAssetOut < amountOutMin) revert SlippageExceeded();

        _trackFee(tokenAddress, netAssetOut, false);

        (uint256 newCurveSupply, uint256 newLtReserve) = _getCurveState(tokenAddress);
        emit Trade(tokenAddress, msg.sender, false, netAssetOut, amountIn, newCurveSupply, newLtReserve);
        return netAssetOut;
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

    function canGraduate(
        address token_
    ) public view returns (bool) {
        if (!_tokenInfo[token_].trading || _tokenInfo[token_].graduated) return false;
        address pair = _tokenInfo[token_].pair;
        address lt = _tokenInfo[token_].ltAddress;
        uint256 realLtBalance = IFPair(pair).assetBalance();
        uint256 exchangeRate = ILeveragedToken(lt).exchangeRate();
        uint256 valueUsd = (realLtBalance * exchangeRate) / 1e18;
        return valueUsd >= GRADUATION_THRESHOLD_USD;
    }

    // ─── Creator Fees ────────────────────────────────────────────────────

    function claimCreatorFees(
        address lt
    ) external nonReentrant {
        uint256 amount = creatorFees[msg.sender][lt];
        if (amount == 0) revert NothingToClaim();
        creatorFees[msg.sender][lt] = 0;
        IERC20(lt).safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, lt, amount);
    }

    function claimProtocolFees(
        address lt
    ) external onlyOwner nonReentrant {
        uint256 amount = protocolFees[lt];
        if (amount == 0) revert NothingToClaim();
        protocolFees[lt] = 0;
        IERC20(lt).safeTransfer(feeTo, amount);
        emit ProtocolFeesClaimed(lt, amount);
    }

    function transferCreator(
        address tokenAddress,
        address newCreator
    ) external {
        TokenInfo storage info = _tokenInfo[tokenAddress];
        if (msg.sender != info.creator) revert NotCreator();
        address oldCreator = info.creator;
        info.creator = newCreator;
        emit CreatorTransferred(tokenAddress, oldCreator, newCreator);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function setParams(
        uint256 newMaxTx,
        address newFeeTo
    ) external onlyOwner {
        maxTx = newMaxTx;
        feeTo = newFeeTo;
    }

    function setHyperswap(
        address newRouter,
        address newLpLock
    ) external onlyOwner {
        hyperswapRouter = newRouter;
        lpLock = newLpLock;
    }

    // ─── Internals ───────────────────────────────────────────────────────

    function _executeBuy(
        address buyer,
        uint256 amountIn,
        address tokenAddress
    ) internal returns (uint256 tokensOut) {
        uint256 netIn;
        (netIn, tokensOut) = router.buy(amountIn, tokenAddress, buyer);

        _trackFee(tokenAddress, amountIn, true);

        (uint256 newCurveSupply, uint256 newLtReserve) = _getCurveState(tokenAddress);
        emit Trade(tokenAddress, buyer, true, netIn, tokensOut, newCurveSupply, newLtReserve);

        if (_tokenInfo[tokenAddress].trading && canGraduate(tokenAddress)) {
            _graduate(tokenAddress);
        }
    }

    function _trackFee(
        address tokenAddress,
        uint256 tradeAmount,
        bool isBuy
    ) internal {
        uint256 taxBps = isBuy ? factory.buyTax() : factory.sellTax();
        uint256 totalFee = (taxBps * tradeAmount) / BPS_DENOM;
        if (totalFee == 0) return;

        uint256 creatorShare = (totalFee * CREATOR_FEE_BPS) / BPS_DENOM;
        uint256 protocolShare = totalFee - creatorShare;

        address lt = _tokenInfo[tokenAddress].ltAddress;
        address creator_ = _tokenInfo[tokenAddress].creator;

        creatorFees[creator_][lt] += creatorShare;
        protocolFees[lt] += protocolShare;
    }

    function _graduate(
        address tokenAddress
    ) internal {
        TokenInfo storage info = _tokenInfo[tokenAddress];
        if (info.graduated || !info.trading) revert TokenAlreadyGraduated();

        info.trading = false;
        info.graduated = true;

        address lt = info.ltAddress;

        // Burn unsold curve tokens from pair
        address pairAddr = info.pair;
        uint256 remainingTokens = IERC20(tokenAddress).balanceOf(pairAddr);
        if (remainingTokens > 0) {
            FERC20(tokenAddress).burn(pairAddr, remainingTokens);
        }

        // Collect all real LT from the bonding curve pair
        uint256 ltFromPair = router.graduate(tokenAddress);

        // Seed HyperSwap V2 pool: LP reserve tokens + collected LT
        uint256 tokenAmount = lpReserve[tokenAddress];
        lpReserve[tokenAddress] = 0;

        IERC20(tokenAddress).forceApprove(hyperswapRouter, tokenAmount);
        IERC20(lt).forceApprove(hyperswapRouter, ltFromPair);

        (,, uint256 liquidity) = IUniswapV2Router02(hyperswapRouter)
            .addLiquidity(tokenAddress, lt, tokenAmount, ltFromPair, tokenAmount, ltFromPair, lpLock, block.timestamp);

        address hyperPair = _getHyperswapPair(tokenAddress, lt);
        graduatedPair[tokenAddress] = hyperPair;

        LPLock(lpLock).recordLock(tokenAddress, hyperPair, liquidity);

        emit TokenGraduated(tokenAddress, hyperPair, liquidity);
    }

    function _getCurveState(
        address tokenAddress
    ) internal view returns (uint256 curveSupply, uint256 ltReserve) {
        address pair = _tokenInfo[tokenAddress].pair;
        (curveSupply, ltReserve) = IFPair(pair).getReserves();
    }

    function _getHyperswapPair(
        address tokenA,
        address tokenB
    ) internal view returns (address) {
        address hsFactory = IUniswapV2Router02(hyperswapRouter).factory();
        // Use staticcall to IUniswapV2Factory.getPair
        (bool ok, bytes memory data) =
            hsFactory.staticcall(abi.encodeWithSignature("getPair(address,address)", tokenA, tokenB));
        require(ok && data.length >= 32, "pair lookup failed");
        return abi.decode(data, (address));
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
