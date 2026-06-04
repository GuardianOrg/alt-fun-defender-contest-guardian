// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Mock HyperSwap V2 pair, behaviourally faithful to canonical
///      `UniswapV2Pair` for the methods the protocol exercises:
///      `mint`, `swap`, `skim`, `getReserves`, `token0/1`, `transfer`.
///      Implementation mirrors the upstream contract — including the
///      `MINIMUM_LIQUIDITY = 1000` first-mint lock and the K-invariant
///      check inside `swap` — so any test pre-seed shape that the real V2
///      pair would reject also reverts here.
contract MockHyperswapPair is ERC20 {
    uint112 private _reserve0;
    uint112 private _reserve1;
    address public token0;
    address public token1;

    /// @dev Camelot-style per-token, owner-settable fees (numerator over
    ///      `FEE_DENOMINATOR`). Default 300 / 100_000 == 0.3%, matching the
    ///      canonical UniswapV2 fee so existing tests are unaffected;
    ///      `setFeePercent` lets tests model HyperSwap raising/lowering a
    ///      pair's fee away from the default.
    uint256 public constant FEE_DENOMINATOR = 100_000;
    uint16 public token0FeePercent = 300;
    uint16 public token1FeePercent = 300;

    /// @dev UniswapV2's `MINIMUM_LIQUIDITY`. The first mint to a virgin pair
    ///      locks this many LP tokens permanently and requires
    ///      `sqrt(amount0 * amount1) > MINIMUM_LIQUIDITY`. Real V2 burns to
    ///      `address(0)`; OZ ERC20 v5 rejects `_mint(0)`, so we lock to a
    ///      sentinel `dead` address instead.
    uint256 internal constant MINIMUM_LIQUIDITY = 1000;
    address internal constant DEAD = address(0xdead);

    constructor() ERC20("HyperSwap LP", "HS-LP") {}

    /// @dev Direct-deposit mint matching UniswapV2 semantics: caller has
    ///      pre-transferred token0/token1 to this pair; we derive the
    ///      deposit from `balanceOf(this) - reserves`, mint LP tokens to
    ///      `to`, and update reserves. Used by `Bonding.finalizeGraduation`
    ///      (Regimes 1 & 2) and by the mock router's `addLiquidity`
    ///      delegate (Regime 3 deposit leg).
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
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY);
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

    /// @dev Standard UniswapV2-style swap. Caller is expected to have
    ///      pre-transferred the input tokens to this pair before calling.
    ///      Used by `Zap._swapOnUniswapV2` (post-grad swaps) and by
    ///      `Bonding._pairRebalance` (hostile-pre-seed defense rebalance).
    ///      Mirrors the reference `UniswapV2Pair.swap` ordering (transfer
    ///      outputs first, then derive inputs from post-transfer balances
    ///      and enforce the K invariant) so a wrong `amountOut` actually
    ///      reverts here.
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

        // K-invariant check charging each input side its own per-token fee,
        // matching CamelotPair (the fork HyperSwap V2 is based on).
        uint256 balance0Adjusted = (balance0 * FEE_DENOMINATOR) - (amount0In * token0FeePercent);
        uint256 balance1Adjusted = (balance1 * FEE_DENOMINATOR) - (amount1In * token1FeePercent);
        require(
            balance0Adjusted * balance1Adjusted >= uint256(reserve0) * uint256(reserve1) * (FEE_DENOMINATOR ** 2),
            "MockPair: K"
        );

        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
    }

    /// @dev Fee-aware output quote mirroring CamelotPair: charges the input
    ///      token's fee percent against `FEE_DENOMINATOR`. Consistent with the
    ///      K-check above by construction.
    function getAmountOut(
        uint256 amountIn,
        address tokenIn
    ) external view returns (uint256) {
        bool inIs0 = tokenIn == token0;
        (uint256 reserveIn, uint256 reserveOut) =
            inIs0 ? (uint256(_reserve0), uint256(_reserve1)) : (uint256(_reserve1), uint256(_reserve0));
        uint256 feePercent = inIs0 ? token0FeePercent : token1FeePercent;
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - feePercent);
        return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    /// @dev Test hook for HyperSwap's owner-settable per-pair fee.
    function setFeePercent(
        uint16 newToken0FeePercent,
        uint16 newToken1FeePercent
    ) external {
        token0FeePercent = newToken0FeePercent;
        token1FeePercent = newToken1FeePercent;
    }

    /// @dev Standard UniswapV2 `skim`: transfer any balance in excess of
    ///      stored reserves to `to`. Used by `Bonding.finalizeGraduation`
    ///      to sweep pure-donation pre-seeds before the rebalance.
    function skim(
        address to
    ) external {
        IERC20 t0 = IERC20(token0);
        IERC20 t1 = IERC20(token1);
        uint256 excess0 = t0.balanceOf(address(this)) - uint256(_reserve0);
        uint256 excess1 = t1.balanceOf(address(this)) - uint256(_reserve1);
        if (excess0 > 0) t0.transfer(to, excess0);
        if (excess1 > 0) t1.transfer(to, excess1);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (_reserve0, _reserve1, uint32(block.timestamp));
    }

    /// @dev Standard UniswapV2 `sync`: force reserves to match balances.
    ///      Permissionless on a real V2 pair, so an attacker can flip a
    ///      pair into the `reserves > 0 && totalSupply == 0` state by
    ///      depositing dust and calling sync — see the regression test
    ///      `test_audit_syncDust_preseed_opensAtCurveRatio`.
    function sync() external {
        _reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        _reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
    }

    function setTokens(
        address t0,
        address t1
    ) external {
        token0 = t0;
        token1 = t1;
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
        pairs[tokenA][tokenB] = address(newPair);
        pairs[tokenB][tokenA] = address(newPair);
        pair = address(newPair);
    }
}

/// @notice Mock of HyperSwap mainnet's V2 router
///         (`0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A`).
/// @dev    HyperSwap's deployed router is NOT a vanilla UniswapV2Router02 —
///         it strips every canonical swap function and replaces them with
///         FoT-only variants that take a non-standard `address referrer`
///         argument. This mock mirrors that surface so tests catch any
///         protocol code that accidentally tries to use the canonical
///         signatures (which would revert with no data on real HyperSwap).
///
///         What's exposed:
///           - `factory()` (canonical)
///           - `addLiquidity(token-token)` (canonical V2)
///           - `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint,uint,address[],address,address,uint)`
///             — the FoT-with-`referrer` variant; included for ABI fidelity,
///             not currently used by the protocol (we route swaps through
///             `pair.swap` directly — see `Bonding._pairRebalance` and
///             `Zap._swapOnUniswapV2`)
///
///         What's NOT exposed (intentionally — matches deployed HyperSwap):
///           - `swapExactTokensForTokens` (canonical) — missing on real router
///           - `swapTokensForExactTokens` — missing
///           - `getAmountsOut` / `getAmountsIn` — not used by protocol
///           - `removeLiquidity*` family — protocol never withdraws LP
///
///         Full deployed-router selector breakdown in
///         `packages/contracts/AGENTS.md` "HyperSwap Router non-standard ABI".
contract MockHyperswapRouter {
    MockHyperswapFactory private immutable _factory;

    constructor() {
        _factory = new MockHyperswapFactory();
    }

    function factory() external view returns (address) {
        return address(_factory);
    }

    /// @dev Mirrors `UniswapV2Router02.addLiquidity` semantics. Computes
    ///      the optimal `(amountA, amountB)` at the current reserve ratio
    ///      via V2's `quote()` formula, pulls only the optimal amounts
    ///      via `transferFrom`, and `pair.mint`s LP. Off-ratio remainder
    ///      stays with the caller — this is what makes
    ///      `Bonding._routerDepositAndDispose` immune to the `min()`
    ///      donation when the pool is at a hostile pre-seed ratio.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        MockHyperswapPair pair = _ensurePair(tokenA, tokenB);
        (amountA, amountB) = _optimalAmounts(pair, tokenA, amountADesired, amountBDesired, amountAMin, amountBMin);
        IERC20(tokenA).transferFrom(msg.sender, address(pair), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(pair), amountB);
        liquidity = pair.mint(to);
    }

    /// @notice HyperSwap's non-standard FoT-with-`referrer` variant.
    /// @dev    Mirrors selector `0xac3893ba` from the deployed router.
    ///         The protocol does NOT call this — both `Bonding` and `Zap`
    ///         route swaps through `pair.swap` directly to sidestep the
    ///         non-standard ABI. The mock implements the FoT semantics
    ///         (slippage check is a final-balance check on `to`) for
    ///         completeness so a future caller that DOES use this would
    ///         exhibit production-faithful behaviour in tests.
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        address, /* referrer */
        uint256 /* deadline */
    ) external {
        require(path.length == 2, "MockRouter: path must be length 2");
        MockHyperswapPair pair = MockHyperswapPair(_factory.pairs(path[0], path[1]));
        require(address(pair) != address(0), "MockRouter: pair not found");

        IERC20(path[0]).transferFrom(msg.sender, address(pair), amountIn);
        uint256 balanceBefore = IERC20(path[1]).balanceOf(to);
        _swapToken1Out(pair, path[0], amountIn, to);
        require(IERC20(path[1]).balanceOf(to) - balanceBefore >= amountOutMin, "MockRouter: INSUFFICIENT_OUTPUT_AMOUNT");
    }

    /// @dev Direction-agnostic pair-swap helper for the FoT variant.
    ///      Computes the canonical V2 fee-charging amountOut from current
    ///      reserves and dispatches `pair.swap(...)` with the appropriate
    ///      `amount0Out` / `amount1Out` slot populated.
    function _swapToken1Out(
        MockHyperswapPair pair,
        address tokenIn,
        uint256 amountIn,
        address to
    ) internal {
        bool inIs0 = pair.token0() == tokenIn;
        uint256 amountOut = pair.getAmountOut(amountIn, tokenIn);
        (uint256 a0, uint256 a1) = inIs0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
        pair.swap(a0, a1, to, new bytes(0));
    }

    function _ensurePair(
        address tokenA,
        address tokenB
    ) internal returns (MockHyperswapPair pair) {
        address pairAddr = _factory.pairs(tokenA, tokenB);
        if (pairAddr == address(0)) {
            pair = new MockHyperswapPair();
            pair.setTokens(tokenA, tokenB);
            _factory.registerPair(tokenA, tokenB, address(pair));
        } else {
            pair = MockHyperswapPair(pairAddr);
        }
    }

    /// @dev Mirrors `UniswapV2Router02._addLiquidity` quote()-based optimal
    ///      split. Empty pair: caller's full desired amounts. Non-empty:
    ///      compute the optimal counter-side at the current reserve ratio
    ///      and revert if it falls below the caller's `min` slippage band.
    function _optimalAmounts(
        MockHyperswapPair pair,
        address tokenA,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal view returns (uint256 amountA, uint256 amountB) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        bool aIs0 = pair.token0() == tokenA;
        (uint256 reserveA, uint256 reserveB) = aIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        if (reserveA == 0 && reserveB == 0) {
            return (amountADesired, amountBDesired);
        }
        uint256 amountBOptimal = (amountADesired * reserveB) / reserveA;
        if (amountBOptimal <= amountBDesired) {
            require(amountBOptimal >= amountBMin, "MockRouter: B<min");
            return (amountADesired, amountBOptimal);
        }
        uint256 amountAOptimal = (amountBDesired * reserveA) / reserveB;
        require(amountAOptimal <= amountADesired, "MockRouter: A>desired");
        require(amountAOptimal >= amountAMin, "MockRouter: A<min");
        return (amountAOptimal, amountBDesired);
    }
}
