# Smart Contract Scope

Forked from Virtuals Protocol `contracts/fun` — a bonding curve system. We replace the quote asset with a BounceTech Leveraged Token (LT) and replace graduation with HyperSwap V2 pool seeding.

---

## Contracts

| Contract | Description |
|---|---|
| `Bonding.sol` | Main entry — launch, buy, sell, graduation (no fee logic — moved to the router) |
| `Factory.sol` | Pair registry |
| `Router.sol` | AMM math, buy/sell execution (returns gross amounts; no fee deduction) |
| `Pair.sol` | Per-token pair: reserves, k-constant |
| `Token.sol` | ERC20 token with burn |
| `Zap.sol` | User-facing entry point — USDC in/out, LT abstraction, **fee layer** |
| `FeeVault.sol` | Holds accrued protocol + creator USDC fees; creators claim here |
| `LPLock.sol` | Holds graduated LP tokens (no withdraw in v1) |

---

## Token Launch

Creator calls `Zap.createToken({ name, ticker, ltAddress, description, image, urls }, seedUsdcAmount)`. The router calls `Bonding.launch()` to deploy the curve, then — if `seedUsdcAmount > 0` — performs the seed buy via the standard `Zap.buy` path so it inherits the same pro-rata fee handling and leftover refund as any other buy.

This deploys a `Token` clone (1B supply) and creates a `Pair` (token/LT). K is computed per token so every token opens at ~`$4K` market cap regardless of which LT is paired.

**Virtual token reserve.** The pair's `reserve0` is seeded at `totalSupply` (1B) while only `curveSupply = 75%` (750M) of real tokens are actually transferred. The other 250M are held in `Bonding` as `lpReserve`. This virtual-reserve design:

- Extends the curve beyond the sellable supply.
- Gives a deterministic supply trigger (curve exhausts at 750M sold).
- Makes the dynamic-LP-seeding parabola `tokensForLP(sold) = sold·(S−sold)/S` peak at exactly `S/4 = 250M = LP_RESERVE` — so `tokensForLP ≤ lpReserve` is a mathematical invariant, not a runtime guess.

Each token stores: creator, token address, pair address, paired LT address, metadata, trading status, graduation status.

---

## Buy Flow

1. `Zap.buy(tokenAddress, usdcAmount, minTokensOut, referrer)`
2. Router pulls `usdcAmount` USDC and deducts the 0.5% fee up-front (forwarded to `FeeVault`, split 0.4% protocol / 0.1% creator)
3. Net USDC is minted to LT
4. If on curve: routes through `Bonding.buy()`. If graduated: swaps on HyperSwap V2 (TOKEN/LT pool). Fee is charged on both paths — symmetric with sells.
5. Tokens sent to user; any leftover LT (capped-buy case) is redeemed back to USDC and refunded along with the pro-rata fee refund

**Overflow buy protection.** On the final buy that would empty the curve, `Router.buy` caps `tokensOut` at the pair's real token balance and back-calculates the LT actually required (`amountInUsed`). `Bonding.buy` returns both `tokensOut` and `amountInUsed`. `Zap.buy` then refunds any unused LT to the buyer by calling `IBounceLeveragedToken.redeem()` (delivered as USDC). If the redeem reverts for any reason (e.g. below the LT's minimum redeem size), the remaining LT is transferred directly to the buyer as a fallback.

## Sell Flow

1. `Zap.sell(tokenAddress, tokenAmount, minUsdcOut)`
2. If on curve: routes through `Bonding.sell()`. If graduated: swaps on HyperSwap V2.
3. LT redeemed atomically via `redeem()` → gross USDC into the router
4. Router deducts the 0.5% fee (forwarded to `FeeVault`, split 0.4% protocol / 0.1% creator); net USDC sent to user in the same tx
   - Sell amount is limited by the LT's idle USDC buffer (`baseAssetBalance()`)
   - Frontend checks buffer and caps sell amounts; users sell in chunks if needed
   - BounceTech automation replenishes the buffer in ~10s after each redeem

---

## Graduation

Dual trigger — fires on whichever hits first:

- **USD trigger:** `assetBalance × exchangeRate ≥ $12K` (HYPE pumps raise the USD value of already-raised LT above the threshold).
- **Supply trigger:** `IPair.tokenBalance() == 0` (all 750M curve tokens sold; handles flat/bear markets where $12K is never reached).

Checked in `Bonding.canGraduate()` on every buy; executed in `Bonding._graduate()` immediately when true.

### Dynamic LP Seeding (zero price gap)

The problem: the reserve asset (LT) has a varying USD price, so the exact number of LP tokens needed to make the DEX pool open at the last curve price is not known ahead of time. Naively seeding the LP with the full 250M reserve would create a large price gap that arbitrage bots would immediately close, transferring value out of the protocol.

Our approach: compute the exact `tokensForLP` at graduation time so the LP opens at **precisely** the last curve price. Burn whatever is left of the 250M reserve.

`_graduate()` performs, in order:

1. Read `(reserve0, reserve1)` from the Pair **before** any state mutation.
2. Burn any unsold real curve tokens from the pair (`unsoldBurned`).
3. Drain all real LT from the pair via `Router.graduate()` (`ltFromPair`).
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

After graduation, all trades continue through `Zap` via HyperSwap. The pool is TOKEN/LT so leveraged exposure persists.

---

## Fees & FeeVault

All fees are charged by `Zap` in USDC and forwarded into `FeeVault`. The router holds no fee state — the vault is where balances live and where creators and the protocol claim.

- **Rate:** 0.5% on every buy/sell (curve **and** post-grad), split 0.4% protocol / 0.1% creator.
- **Accrual:** `Zap` transfers the fee USDC to `FeeVault`, then calls `FeeVault.accrue(token, creator, creatorAmount, protocolAmount, isBuy)`. Creator attribution comes from `Bonding.tokenInfo(token).creator` (set at launch, updatable via `transferCreator`).
- **Claims:** `FeeVault.claim()` pays the caller their pooled USDC balance across every token they've launched. `FeeVault.claimProtocol()` is owner-only and pays the configured `feeTo`.
- **Lifetime counters:** `lifetimeCreatorEarned(creator)` / `lifetimeProtocolEarned` never decrement on claim, so the UI can render "total earned / claimed / claimable" consistently.
- **Router swapability:** The vault has an owner-controlled depositor allowlist. A new router is whitelisted, the old router removed, and creator balances are untouched during the transition.
- `transferCreator(tokenAddress, newCreator)` (on `Bonding`) — transfers role and future fee attribution.

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
| `FeeAccrued` | FeeVault | `token`, `creator`, `creatorAmount`, `protocolAmount`, `isBuy` |
| `CreatorFeesClaimed` | FeeVault | `creator`, `amount` (USDC) |
| `ProtocolFeesClaimed` | FeeVault | `feeTo`, `amount` (USDC) |
| `Buy` | Zap | `token`, `buyer`, `usdcIn`, `tokensOut` |
| `Sell` | Zap | `token`, `seller`, `tokensIn`, `usdcOut` |
| `Referred` | Zap | `trader`, `referrer`, `token`, `usdcAmount` |
| `TokenCreated` | Zap | `token`, `creator`, `ltAddress` |

---

## External Integrations

**HyperSwap V2** — standard Uniswap V2 fork.
- Factory: `0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48`
- Router: `0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A`

**BounceTech LT** — see root `AGENTS.md` for the interface and constraints.
