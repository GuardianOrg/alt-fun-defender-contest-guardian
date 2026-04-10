// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockHyperswapPair is ERC20 {
    uint112 private _reserve0;
    uint112 private _reserve1;

    constructor() ERC20("HyperSwap LP", "HS-LP") {}

    function mint(
        address to,
        uint256 amount
    ) external {
        _mint(to, amount);
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

/// @dev Minimal mock of UniswapV2Router02 for graduation tests
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
