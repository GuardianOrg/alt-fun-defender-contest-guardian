# Smart Contract Scope

Forked from Virtuals Protocol `contracts/fun` — a bonding curve system. We replace the quote asset with a BounceTech Leveraged Token (LT) and replace graduation with HyperSwap V2 pool seeding.

---

## Contracts

| Contract | Description |
|---|---|
| `Bonding.sol` | Main entry — launch, buy, sell, graduation, fee collection |
| `FFactory.sol` | Pair registry and fee config |
| `FRouter.sol` | AMM math, buy/sell execution |
| `FPair.sol` | Per-token pair: reserves, k-constant |
| `FERC20.sol` | Memecoin ERC20 with burn |
| `RedemptionRouter.sol` | User-facing entry point — USDC in/out, LT abstraction |
| `LPLock.sol` | Holds graduated LP tokens (no withdraw in v1) |

---

## Token Launch

Creator calls `Bonding.launch()` with: name, ticker, LT pair address, description, image URL, social URLs, optional seed buy amount.

This deploys an `FERC20` (1B supply) and creates an `FPair` (memecoin/LT). K is computed per token so every token opens at ~`$4K` market cap regardless of which LT is paired.

Each token stores: creator, token address, pair address, paired LT address, metadata, trading status, graduation status.

---

## Buy Flow

1. `RedemptionRouter.buy(tokenAddress, usdcAmount, minMemeOut, deadline, referrer)`
2. Router takes USDC from user → mints LT
3. If on curve: routes through `Bonding.buy()`. If graduated: swaps on HyperSwap.
4. 0.5% fee deducted on curve trades (0.4% protocol, 0.1% creator)
5. Memecoin sent to user

## Sell Flow

1. `RedemptionRouter.sell(tokenAddress, memeAmount, minUsdcOut, deadline)`
2. If on curve: routes through `Bonding.sell()`. If graduated: swaps on HyperSwap.
3. 0.5% fee deducted on curve trades
4. LT redeemed → USDC sent to user
   - Most sells: atomic `redeem()` — single tx
   - Large sells (rare): `prepareRedeem()` — USDC arrives ~15s later, user calls `claimRedeem()`

---

## Graduation

Fires when `LT_reserves × exchangeRate ≥ $12K`.

1. Curve closes
2. Unsold curve tokens burned
3. 250M reserved tokens + all raised LT → `addLiquidity()` on HyperSwap V2
4. LP tokens sent to `LPLock` contract

After graduation, all trades continue through `RedemptionRouter` via HyperSwap. The pool is MEMECOIN/LT so leveraged exposure persists.

---

## Creator Fees

- Fees accrue per-creator in a claimable mapping
- `claimCreatorFees()` — creator withdraws
- `transferCreator(tokenAddress, newCreator)` — transfers role and future fees

---

## Referral Tracking

- `buy()` accepts optional `referrer` address
- Emits `Referred(buyer, referrer, token, usdcAmount)` for off-chain indexing
- No on-chain fee split in v1

---

## Events

| Event | Contract | Fields |
|---|---|---|
| `TokenLaunched` | Bonding | `token`, `creator`, `ltAddress`, `name`, `ticker` |
| `Buy` | Bonding | `token`, `buyer`, `amountIn`, `amountOut`, `price`, `timestamp` |
| `Sell` | Bonding | `token`, `seller`, `amountIn`, `amountOut`, `price`, `timestamp` |
| `Graduated` | Bonding | `token`, `poolAddress` |
| `Referred` | RedemptionRouter | `buyer`, `referrer`, `token`, `usdcAmount` |

---

## External Integrations

**HyperSwap V2** — standard Uniswap V2 fork.
- Factory: `0x4df039804873717bff7d03694fb941cf0469b79e`
- Router: `0xda0f518d521e0dE83fAdC8500C2D21b6a6C39bF9`

**BounceTech LT** — see root `AGENTS.md` for the interface and constraints.
