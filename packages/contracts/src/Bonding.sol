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

/// @title Bonding
/// @notice Constant-product bonding curve for the memecoin launchpad.
/// @dev Forked from Virtuals Protocol Bonding.sol. Simplified graduation (no agent factory).
///      K constant controls curve shape. Virtual liquidity bootstraps the curve without real capital.
///      Graduation triggers when token reserves drop below gradThreshold.
contract Bonding is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    FFactory public factory;
    FRouter public router;
    address public feeTo;

    uint256 public fee;
    uint256 public K;
    uint256 public assetRate;
    uint256 public gradThreshold;
    uint256 public maxTx;

    struct TokenInfo {
        address creator;
        address token;
        address pair;
        string name;
        string ticker;
        string description;
        string image;
        string twitter;
        string telegram;
        string youtube;
        string website;
        bool trading;
        bool graduated;
    }

    struct LaunchParams {
        string name;
        string ticker;
        string description;
        string image;
        string[4] urls;
        uint256 purchaseAmount;
    }

    mapping(address => TokenInfo) internal _tokenInfo;
    address[] public allTokens;
    mapping(address => address[]) public creatorTokens;

    event Launched(address indexed token, address indexed pair, address indexed creator, uint256 index);
    event Graduated(address indexed token, uint256 assetAmount, uint256 tokensBurned);
    event Buy(address indexed token, address indexed buyer, uint256 assetIn, uint256 tokensOut);
    event Sell(address indexed token, address indexed seller, uint256 tokensIn, uint256 assetOut);

    error TokenNotTrading();
    error TokenAlreadyGraduated();
    error InvalidInput();
    error SlippageExceeded();
    error DeadlineExpired();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address router_,
        address feeTo_,
        uint256 fee_,
        uint256 assetRate_,
        uint256 maxTx_,
        uint256 gradThreshold_
    ) external initializer {
        __Ownable_init(msg.sender);

        factory = FFactory(factory_);
        router = FRouter(router_);
        feeTo = feeTo_;
        fee = fee_;
        K = 3_000_000_000_000;
        assetRate = assetRate_;
        maxTx = maxTx_;
        gradThreshold = gradThreshold_;
    }

    // ─── Launch ──────────────────────────────────────────────────────────

    function launch(
        LaunchParams calldata params
    ) external nonReentrant returns (address, address, uint256) {
        if (params.purchaseAmount <= fee) revert InvalidInput();

        address assetToken = router.assetToken();
        uint256 initialPurchase = params.purchaseAmount - fee;

        IERC20(assetToken).safeTransferFrom(msg.sender, feeTo, fee);
        IERC20(assetToken).safeTransferFrom(msg.sender, address(this), initialPurchase);

        (address tokenAddr, address pair) = _deployAndSeed(params.name, params.ticker, assetToken);

        _storeTokenInfo(tokenAddr, pair, params);

        emit Launched(tokenAddr, pair, msg.sender, allTokens.length);

        IERC20(assetToken).forceApprove(address(router), initialPurchase);
        _buy(address(this), initialPurchase, tokenAddr, 0);
        IERC20(tokenAddr).safeTransfer(msg.sender, IERC20(tokenAddr).balanceOf(address(this)));

        return (tokenAddr, pair, allTokens.length);
    }

    function _deployAndSeed(
        string calldata name_,
        string calldata ticker_,
        address assetToken
    ) internal returns (address tokenAddr, address pair) {
        FERC20 token = new FERC20{salt: keccak256(abi.encodePacked(msg.sender, block.timestamp))}(
            string.concat("fun ", name_), ticker_, maxTx, address(this)
        );
        tokenAddr = address(token);
        uint256 supply = token.totalSupply();

        pair = factory.createPair(tokenAddr, assetToken);

        uint256 k = (K * 10_000) / assetRate;
        uint256 liquidity = (((k * 10_000 ether) / supply) * 1 ether) / 10_000;

        IERC20(tokenAddr).forceApprove(address(router), supply);
        router.addInitialLiquidity(tokenAddr, supply, liquidity);
    }

    function _storeTokenInfo(
        address tokenAddr,
        address pair,
        LaunchParams calldata params
    ) internal {
        _tokenInfo[tokenAddr] = TokenInfo({
            creator: msg.sender,
            token: tokenAddr,
            pair: pair,
            name: params.name,
            ticker: params.ticker,
            description: params.description,
            image: params.image,
            twitter: params.urls[0],
            telegram: params.urls[1],
            youtube: params.urls[2],
            website: params.urls[3],
            trading: true,
            graduated: false
        });
        allTokens.push(tokenAddr);
        creatorTokens[msg.sender].push(tokenAddr);
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
        return _buy(msg.sender, amountIn, tokenAddress, amountOutMin);
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

        emit Sell(tokenAddress, msg.sender, amountIn, netAssetOut);
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
            string memory name_,
            string memory ticker,
            bool trading,
            bool graduated
        )
    {
        TokenInfo storage info = _tokenInfo[token_];
        return (info.creator, info.token, info.pair, info.name, info.ticker, info.trading, info.graduated);
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

    // ─── Admin ───────────────────────────────────────────────────────────

    function setParams(
        uint256 newFee,
        uint256 newAssetRate,
        uint256 newMaxTx,
        uint256 newGradThreshold,
        address newFeeTo
    ) external onlyOwner {
        if (newAssetRate == 0) revert InvalidInput();
        fee = newFee;
        assetRate = newAssetRate;
        maxTx = newMaxTx;
        gradThreshold = newGradThreshold;
        feeTo = newFeeTo;
    }

    // ─── Internals ───────────────────────────────────────────────────────

    function _buy(
        address buyer,
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin
    ) internal returns (uint256 tokensOut) {
        address pairAddr = factory.getPair(tokenAddress, router.assetToken());
        IFPair pair = IFPair(pairAddr);
        (uint256 reserveToken,) = pair.getReserves();

        uint256 netIn;
        (netIn, tokensOut) = router.buy(amountIn, tokenAddress, buyer);

        if (tokensOut < amountOutMin) revert SlippageExceeded();

        emit Buy(tokenAddress, buyer, netIn, tokensOut);

        uint256 newReserveToken = reserveToken - tokensOut;
        if (newReserveToken <= gradThreshold && _tokenInfo[tokenAddress].trading) {
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

        uint256 assetAmount = router.graduate(tokenAddress);

        address pairAddr = info.pair;
        uint256 remainingTokens = IERC20(tokenAddress).balanceOf(pairAddr);
        if (remainingTokens > 0) {
            FERC20(tokenAddress).burn(pairAddr, remainingTokens);
        }

        emit Graduated(tokenAddress, assetAmount, remainingTokens);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
