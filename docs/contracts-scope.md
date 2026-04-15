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
| `FERC20.sol` | ERC20 token with burn |
| `LaunchpadRouter.sol` | User-facing entry point — USDC in/out, LT abstraction |
| `LPLock.sol` | Holds graduated LP tokens (no withdraw in v1) |

---

## Token Launch

Creator calls `Bonding.launch()` with: name, ticker, LT pair address, description, image URL, social URLs, optional seed buy amount.

This deploys an `FERC20` (1B supply) and creates an `FPair` (token/LT). K is computed per token so every token opens at ~`$4K` market cap regardless of which LT is paired.

Each token stores: creator, token address, pair address, paired LT address, metadata, trading status, graduation status.

---

## Buy Flow

1. `LaunchpadRouter.buy(tokenAddress, usdcAmount, minTokensOut, referrer)`
2. Router takes USDC from user → mints LT
3. If on curve: routes through `Bonding.buy()`. If graduated: swaps on HyperSwap.
4. 0.5% fee deducted on curve trades (0.4% protocol, 0.1% creator)
5. Tokens sent to user

## Sell Flow

1. `LaunchpadRouter.sell(tokenAddress, tokenAmount, minUsdcOut)`
2. If on curve: routes through `Bonding.sell()`. If graduated: swaps on HyperSwap.
3. 0.5% fee deducted on curve trades
4. LT redeemed atomically via `redeem()` → USDC sent to user in single tx
   - Sell amount is limited by the LT's idle USDC buffer (`baseAssetBalance()`)
   - Frontend checks buffer and caps sell amounts; users sell in chunks if needed
   - BounceTech automation replenishes the buffer in ~10s after each redeem

---

## Graduation

Fires when `LT_reserves × exchangeRate ≥ $12K`.

1. Curve closes
2. Unsold curve tokens burned
3. 250M reserved tokens + all raised LT → `addLiquidity()` on HyperSwap V2
4. LP tokens sent to `LPLock` contract

After graduation, all trades continue through `LaunchpadRouter` via HyperSwap. The pool is TOKEN/LT so leveraged exposure persists.

---

## Creator Fees

- Fees accrue per-creator in a claimable mapping
- `claimCreatorFees()` — creator withdraws
- `transferCreator(tokenAddress, newCreator)` — transfers role and future fees

---

## Referral Tracking

- `buy()` accepts optional `referrer` address
- Emits `Referred(token, trader, referrer, usdcAmount)` for off-chain indexing
- No on-chain fee split in v1

---

## Events

| Event | Contract | Fields |
|---|---|---|
| `TokenLaunched` | Bonding | `token`, `creator`, `ltAddress`, `name`, `ticker`, `k`, `index` |
| `Trade` | Bonding | `token`, `trader`, `isBuy`, `ltAmount`, `tokenAmount`, `newCurveSupply`, `newLtReserve` |
| `TokenGraduated` | Bonding | `token`, `pairAddress`, `liquidity` |
| `CreatorFeesClaimed` | Bonding | `creator`, `lt`, `amount` |
| `ProtocolFeesClaimed` | Bonding | `lt`, `amount` |
| `Buy` | LaunchpadRouter | `token`, `buyer`, `usdcIn`, `tokensOut` |
| `Sell` | LaunchpadRouter | `token`, `seller`, `tokensIn`, `usdcOut` |
| `Referred` | LaunchpadRouter | `trader`, `referrer`, `token`, `usdcAmount` |
| `TokenCreated` | LaunchpadRouter | `token`, `creator`, `ltAddress` |

---

## External Integrations

**HyperSwap V2** — standard Uniswap V2 fork.
- Factory: `0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48`
- Router: `0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A`

**BounceTech LT** — see root `AGENTS.md` for the interface and constraints.
