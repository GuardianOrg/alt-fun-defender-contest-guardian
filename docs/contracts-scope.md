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

**Virtual token reserve.** The pair's `reserve0` is seeded at `totalSupply` (1B) while only `curveSupply = 75%` (750M) of real tokens are actually transferred. The other 250M are held in `Bonding` as `lpReserve`. This virtual-reserve design:

- Extends the curve beyond the sellable supply.
- Gives a deterministic supply trigger (curve exhausts at 750M sold).
- Makes the dynamic-LP-seeding parabola `tokensForLP(sold) = sold·(S−sold)/S` peak at exactly `S/4 = 250M = LP_RESERVE` — so `tokensForLP ≤ lpReserve` is a mathematical invariant, not a runtime guess.

Each token stores: creator, token address, pair address, paired LT address, metadata, trading status, graduation status.

---

## Buy Flow

1. `LaunchpadRouter.buy(tokenAddress, usdcAmount, minTokensOut, referrer)`
2. Router takes USDC from user → mints LT
3. If on curve: routes through `Bonding.buy()`. If graduated: swaps on HyperSwap.
4. 0.5% fee deducted on curve trades (0.4% protocol, 0.1% creator)
5. Tokens sent to user

**Overflow buy protection.** On the final buy that would empty the curve, `FRouter.buy` caps `tokensOut` at the pair's real token balance and back-calculates the LT actually required (`amountInUsed`). `Bonding.buy` returns both `tokensOut` and `amountInUsed`. `LaunchpadRouter.buy` then refunds any unused LT to the buyer by calling `ILeveragedToken.redeem()` (delivered as USDC). If the redeem reverts for any reason (e.g. below the LT's minimum redeem size), the remaining LT is transferred directly to the buyer as a fallback.

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

Dual trigger — fires on whichever hits first:

- **USD trigger:** `assetBalance × exchangeRate ≥ $12K` (HYPE pumps raise the USD value of already-raised LT above the threshold).
- **Supply trigger:** `IFPair.tokenBalance() == 0` (all 750M curve tokens sold; handles flat/bear markets where $12K is never reached).

Checked in `Bonding.canGraduate()` on every buy; executed in `Bonding._graduate()` immediately when true.

### Dynamic LP Seeding (zero price gap)

The problem: the reserve asset (LT) has a varying USD price, so the exact number of LP tokens needed to make the DEX pool open at the last curve price is not known ahead of time. Naively seeding the LP with the full 250M reserve would create a large price gap that arbitrage bots would immediately close, transferring value out of the protocol.

Our approach: compute the exact `tokensForLP` at graduation time so the LP opens at **precisely** the last curve price. Burn whatever is left of the 250M reserve.

`_graduate()` performs, in order:

1. Read `(reserve0, reserve1)` from the FPair **before** any state mutation.
2. Burn any unsold real curve tokens from the pair (`unsoldBurned`).
3. Drain all real LT from the pair via `FRouter.graduate()` (`ltFromPair`).
4. Compute `tokensForLP = (ltFromPair × reserve0) / reserve1` — the unique amount that sets the LP price `ltFromPair / tokensForLP` equal to the last curve price `reserve1 / reserve0`. Capped at `lpReserveTotal` as a defensive guard (parabola math proves `tokensForLP ≤ lpReserveTotal` by construction).
5. Burn `lpReserveTotal − tokensForLP` from `Bonding`'s held reserve (`lpBurned`).
6. `addLiquidity(tokensForLP, ltFromPair)` on HyperSwap V2 → LP tokens go to `LPLock`.

### Invariants

All enforced by `test/GraduationInvariants.t.sol`:

| # | Invariant | Mechanism |
|---|---|---|
| 1 | Zero price gap | `ltFromPair × reserve0End ≈ tokensInLP × reserve1End` within 1 bps |
| 2 | Conservation | `tokensInLP + lpBurned == LP_RESERVE` (250M) |
| 3 | Parabola cap | `tokensInLP ≤ LP_RESERVE` always (guaranteed by virtual reserve setup) |
| 4 | Pair drained | `tokenBalance() == 0` and `assetBalance() == 0` post-graduation |
| 5 | Both triggers work | Supply trigger fires below `$12K`; USD trigger fires with supply remaining |
| 6 | Overflow refund | Oversized buys charge only `amountInUsed`, not requested amount |

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
| `TokenGraduated` | Bonding | `token`, `pairAddress`, `liquidity`, `tokensInLP`, `lpBurned`, `unsoldBurned` |
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
