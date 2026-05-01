// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockHyperswapPair is ERC20 {
    uint112 private _reserve0;
    uint112 private _reserve1;
    address public token0;
    address public token1;
    address public authorizedRouter;

    constructor() ERC20("HyperSwap LP", "HS-LP") {}

    /// @dev Direct-deposit mint matching UniswapV2 semantics: the caller has
    ///      pre-transferred token0/token1 to this pair; we derive the deposit
    ///      from `balanceOf(this) - reserves`, mint LP tokens to `to`, and
    ///      update reserves. Used by `Bonding.finalizeGraduation` (router-bypass
    ///      LP seeding) and tested in `TwoPhaseGraduation.t.sol`.
    function mint(
        address to
    ) external returns (uint256 liquidity) {
        uint112 reserve0 = _reserve0;
        uint112 reserve1 = _reserve1;

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;

        uint256 totalSupply_ = totalSupply();
        if (totalSupply_ == 0) {
            liquidity = _sqrt(amount0 * amount1);
        } else {
            uint256 liquidity0 = (amount0 * totalSupply_) / reserve0;
            uint256 liquidity1 = (amount1 * totalSupply_) / reserve1;
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        }
        require(liquidity > 0, "MockPair: INSUFFICIENT_LIQUIDITY_MINTED");

        _mint(to, liquidity);

        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
    }

    /// @dev Legacy bookkeeping path used by the router's `addLiquidity` mock
    ///      (which manages reserves itself). Kept under a different name so the
    ///      UniswapV2-style `mint(to)` above is unambiguous.
    function mintRaw(
        address to,
        uint256 amount
    ) external {
        _mint(to, amount);
    }

    function _sqrt(
        uint256 y
    ) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function setTokens(
        address t0,
        address t1
    ) external {
        token0 = t0;
        token1 = t1;
    }

    function setRouter(
        address router_
    ) external {
        authorizedRouter = router_;
    }

    function setReserves(
        uint112 r0,
        uint112 r1
    ) external {
        _reserve0 = r0;
        _reserve1 = r1;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (_reserve0, _reserve1, uint32(block.timestamp));
    }

    function routerTransfer(
        address token,
        address to,
        uint256 amount
    ) external {
        require(msg.sender == authorizedRouter, "only router");
        IERC20(token).transfer(to, amount);
    }

    /// @dev Standard UniswapV2-style swap. Caller is expected to have
    ///      pre-transferred the input tokens to this pair before calling.
    ///      Used by `Zap`'s direct-to-pair swap path. Mirrors the reference
    ///      `UniswapV2Pair.swap` ordering (transfer outputs first, then derive
    ///      inputs from post-transfer balances and enforce the K invariant) so
    ///      bad `amountOut` calculations actually revert here.
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata /* data */
    ) external {
        require(amount0Out > 0 || amount1Out > 0, "MockPair: INSUFFICIENT_OUTPUT_AMOUNT");

        uint112 reserve0 = _reserve0;
        uint112 reserve1 = _reserve1;
        require(amount0Out < reserve0 && amount1Out < reserve1, "MockPair: INSUFFICIENT_LIQUIDITY");

        if (amount0Out > 0) IERC20(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).transfer(to, amount1Out);

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        uint256 amount0In = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "MockPair: INSUFFICIENT_INPUT_AMOUNT");

        // K-invariant check with 0.3% fee, matching UniswapV2Pair.
        uint256 balance0Adjusted = (balance0 * 1000) - (amount0In * 3);
        uint256 balance1Adjusted = (balance1 * 1000) - (amount1In * 3);
        require(
            balance0Adjusted * balance1Adjusted >= uint256(reserve0) * uint256(reserve1) * (1000 ** 2), "MockPair: K"
        );

        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
    }
}

contract MockHyperswapFactory {
    mapping(address => mapping(address => address)) public pairs;

    function getPair(
        address tokenA,
        address tokenB
    ) external view returns (address) {
        return pairs[tokenA][tokenB];
    }

    function registerPair(
        address tokenA,
        address tokenB,
        address pair
    ) external {
        pairs[tokenA][tokenB] = pair;
        pairs[tokenB][tokenA] = pair;
    }

    /// @dev Matches `IUniswapV2Factory.createPair` so `Bonding._ensureUniswapV2Pair`
    ///      can deploy a pair on-the-fly during `finalizeGraduation` without
    ///      going through the router.
    function createPair(
        address tokenA,
        address tokenB
    ) external returns (address pair) {
        require(pairs[tokenA][tokenB] == address(0), "MockFactory: PAIR_EXISTS");
        MockHyperswapPair newPair = new MockHyperswapPair();
        newPair.setTokens(tokenA, tokenB);
        // No router authorization here — the post-grad swap path uses
        // `pair.swap(...)` directly which doesn't gate on router auth.
        pairs[tokenA][tokenB] = address(newPair);
        pairs[tokenB][tokenA] = address(newPair);
        pair = address(newPair);
    }
}

/// @dev Mock UniswapV2Router02 for graduation and post-grad swap tests
contract MockHyperswapRouter {
    MockHyperswapFactory private immutable _factory;

    constructor() {
        _factory = new MockHyperswapFactory();
    }

    function factory() external view returns (address) {
        return address(_factory);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256,
        uint256,
        address to,
        uint256
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);

        address existing = _factory.pairs(tokenA, tokenB);
        MockHyperswapPair pair;
        if (existing == address(0)) {
            pair = new MockHyperswapPair();
            pair.setTokens(tokenA, tokenB);
            pair.setRouter(address(this));
            _factory.registerPair(tokenA, tokenB, address(pair));
        } else {
            pair = MockHyperswapPair(existing);
        }

        IERC20(tokenA).transfer(address(pair), amountADesired);
        IERC20(tokenB).transfer(address(pair), amountBDesired);
        pair.setReserves(uint112(amountADesired), uint112(amountBDesired));

        liquidity = _sqrt(amountADesired * amountBDesired);
        pair.mintRaw(to, liquidity);

        return (amountADesired, amountBDesired, liquidity);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        require(path.length == 2, "MockRouter: path must be length 2");
        address pairAddr = _factory.pairs(path[0], path[1]);
        require(pairAddr != address(0), "MockRouter: pair not found");

        IERC20(path[0]).transferFrom(msg.sender, pairAddr, amountIn);

        uint256 amountOut = _computeAmountOut(pairAddr, path[0], amountIn);
        require(amountOut >= amountOutMin, "MockRouter: insufficient output");

        MockHyperswapPair(pairAddr).routerTransfer(path[1], to, amountOut);
        _updateReserves(pairAddr, path[0], amountIn, amountOut);

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        require(path.length == 2, "MockRouter: path must be length 2");
        address pairAddr = _factory.pairs(path[0], path[1]);
        require(pairAddr != address(0), "MockRouter: pair not found");

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = _computeAmountOut(pairAddr, path[0], amountIn);
    }

    function _computeAmountOut(
        address pairAddr,
        address tokenIn,
        uint256 amountIn
    ) internal view returns (uint256) {
        MockHyperswapPair pair = MockHyperswapPair(pairAddr);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        bool isZero = pair.token0() == tokenIn;
        uint256 rIn = isZero ? r0 : r1;
        uint256 rOut = isZero ? r1 : r0;
        return (amountIn * rOut) / (rIn + amountIn);
    }

    function _updateReserves(
        address pairAddr,
        address tokenIn,
        uint256 amtIn,
        uint256 amtOut
    ) internal {
        MockHyperswapPair pair = MockHyperswapPair(pairAddr);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        if (pair.token0() == tokenIn) {
            pair.setReserves(uint112(uint256(r0) + amtIn), uint112(uint256(r1) - amtOut));
        } else {
            pair.setReserves(uint112(uint256(r0) - amtOut), uint112(uint256(r1) + amtIn));
        }
    }

    function _sqrt(
        uint256 y
    ) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
