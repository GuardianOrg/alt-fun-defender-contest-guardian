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

    function mint(
        address to,
        uint256 amount
    ) external {
        _mint(to, amount);
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
        pair.mint(to, liquidity);

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
