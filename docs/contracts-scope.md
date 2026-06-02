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

Creator calls `Zap.createToken({ name, ticker, ltAddress, description, image, urls }, seedUsdcAmount)`. The router calls `Bonding.launch()` to deploy the curve, then performs the **mandatory** seed buy via the standard `Zap.buy` path so it inherits the same pro-rata fee handling and leftover refund as any other buy.

### Anti-snipe gate

`seedUsdcAmount` must be `≥ Zap.MIN_SEED_USDC` (`$20`, real USDC, 6dp). On top of that, `Bonding` blocks every public buy on the curve for the next `LAUNCH_TRADING_DELAY_BLOCKS` (`= 3`) blocks — trading opens at `launchBlock + LAUNCH_TRADING_DELAY_BLOCKS + 1`. The seed buy bypasses the gate via a transient-storage flag set inside `Bonding.launch` and consumed by the very next `Bonding.buy` in the same tx, so the creator's seed always lands while same-block sniper bundles (separate txs, transient cleared) revert with `TradingNotOpen`. The gate is buy-only: sells are not delayed, so a creator can withdraw the seed within the window — accepted for the same reason the seed is uncapped (below), since a creator controls their own open regardless and cannot be forced to leave the seed in the curve.

There is **no upper bound** on the seed. A cap is trivially bypassable (the same creator seeds via wallet A then snipes the open at block N+4 from wallet B), and seed-and-burn launches are a legitimate supply pattern. The floor is the only side that protects the curve floor from being free.

This deploys a `Token` clone (1B supply) and creates a `Pair` (token/LT). K is computed per token so every token opens at ~`$3K` market cap regardless of which LT is paired.

**Virtual token reserve.** The pair's `reserve0` is seeded at `totalSupply` (1B) while only `curveSupply = 75%` (750M) of real tokens are actually transferred. The other 250M are held in `Bonding` as `lpReserve`. This virtual-reserve design:

- Extends the curve beyond the sellable supply.
- Gives a deterministic supply trigger (curve exhausts at 750M sold).
- Makes the dynamic-LP-seeding parabola `tokensForLP(sold) = sold·(S−sold)/S` peak at exactly `S/4 = 250M = LP_RESERVE` — so `tokensForLP ≤ lpReserve` is a mathematical invariant, not a runtime guess.

Each token stores: creator, token address, pair address, paired LT address, metadata, trading status, graduation status.

---

## Buy Flow

1. `Zap.buy(tokenAddress, usdcAmount, minTokensOut, referrer)`
2. `Zap` pulls `usdcAmount` USDC and deducts the 0.75% Alt Fun fee up-front (forwarded to `FeeVault`, split 0.5% protocol / 0.25% creator). The fee is charged on every buy — curve **and** post-graduation — not just curve trades.
3. Net USDC is minted to LT
4. If on curve: routes through `Bonding.buy()` (the internal AMM `Router.sol`). If graduated: swaps on HyperSwap V2 (TOKEN/LT pool). The 0.75% Alt Fun fee is identical on both paths; post-grad, HyperSwap also charges its own 0.3% LP fee on the swap leg, on top of the Alt Fun fee.
5. Tokens sent to user; any leftover LT (capped-buy case) is redeemed back to USDC and refunded along with the pro-rata fee refund

**Overflow buy protection.** On the final buy that would empty the curve, `Router.buy` caps `tokensOut` at the pair's real token balance and back-calculates the LT actually required (`amountInUsed`). `Bonding.buy` returns both `tokensOut` and `amountInUsed`. `Zap.buy` then refunds any unused LT to the buyer by calling `IBounceLeveragedToken.redeem()` (delivered as USDC). If the redeem reverts for any reason (e.g. below the LT's minimum redeem size), the remaining LT is transferred directly to the buyer as a fallback.

## Sell Flow

1. `Zap.sell(tokenAddress, tokenAmount, minUsdcOut)`
2. If on curve: routes through `Bonding.sell()` (the internal AMM `Router.sol`). If graduated: swaps on HyperSwap V2 (which charges a 0.3% LP fee on the swap leg, on top of the Alt Fun fee deducted below).
3. LT redeemed atomically via `redeem()` → gross USDC into `Zap`
4. `Zap` deducts the 0.75% Alt Fun fee (forwarded to `FeeVault`, split 0.5% protocol / 0.25% creator) — identical on curve and post-grad — and sends net USDC to the user in the same tx
   - Sell amount is limited by the LT's idle USDC buffer (`baseAssetBalance()`)
   - Frontend checks buffer and caps sell amounts; users sell in chunks if needed
   - BounceTech automation replenishes the buffer in ~10s after each redeem

---

## Graduation

Dual trigger — fires on whichever hits first:

- **USD trigger:** `(storedAssetReserve - virtualLtReserve) × exchangeRate ≥ $9K` (HYPE pumps raise the USD value of already-raised LT above the threshold). Reads the pair's STORED reserves; the launch-time `virtualLtReserve` is recovered on-the-fly as `Pair.k() / Token.TOTAL_SUPPLY()` because `_pool.k = totalSupply * virtualLtReserve` is locked in at `Pair.mint` and never modified by swaps.
- **Supply trigger:** `IPair.tokenBalance() == 0` (all 750M curve tokens sold; handles flat/bear markets where $9K is never reached). This IS a live `balanceOf` read but is donation-resistant in the opposite direction — token donations can only INCREASE the balance and can never satisfy `== 0`. Any donated tokens are unconditionally burned by `_prepareGraduationLiquidity`.

Direct LT donations to the pair don't count toward the USD threshold and don't enter the LP — they stay in the curve pair under the trust assumption that `BONDING_ROLE` is only ever held by `Bonding`. `Bonding.canGraduate()` is checked at the end of every buy inside `_executeBuy`; phase 1 (`Bonding._enterGraduating`) fires inline at the end of the threshold-crossing buy. There is no rate-only trigger: a USD ripening driven purely by `exchangeRate()` motion (no intervening buy) holds the ripe state only while the rate stays above threshold, and is settled by the next buy that lands while still ripe. The supply trigger is monotonic — once `tokenBalance() == 0` it cannot un-ripen, so the next buy will graduate it. Sells cannot satisfy either trigger (they reduce stored LT raised and return tokens to the pair).

### Dynamic LP Seeding (zero price gap)

The problem: the reserve asset (LT) has a varying USD price, so the exact number of LP tokens needed to make the DEX pool open at the last curve price is not known ahead of time. Naively seeding the LP with the full 250M reserve would create a large price gap that arbitrage bots would immediately close, transferring value out of the protocol.

Our approach: compute the exact `tokensForLP` at graduation time so the LP opens at **precisely** the last curve price. Burn whatever is left of the 250M reserve.

`_graduate()` performs, in order:

1. Read `(reserve0, reserve1)` from the Pair **before** any state mutation.
2. Burn any unsold real curve tokens from the pair (`unsoldBurned`). This also burns any tokens donated to the pair via direct ERC20 transfer.
3. Recover `virtualLtReserve = Pair.k() / Token.TOTAL_SUPPLY()` and compute `ltFromPair = reserve1 - virtualLtReserve` — the real LT raised by the curve, excluding the launch-time virtual seed AND any LT donated to the pair. Drain exactly that amount via `Router.graduate(token, ltFromPair)`. Donated LT remains in the curve pair, reachable only via `Pair.transferAsset` which is gated by `Router`'s `BONDING_ROLE`.
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
| 4 | Pair drained | `tokenBalance() == 0` post-graduation. `assetBalance() == 0` only when no donations occurred — any LT donated directly to the pair is excluded from LP seeding and remains locked in the pair. |
| 5 | Both triggers work | Supply trigger fires below `$9K`; USD trigger fires with supply remaining |
| 6 | Overflow refund | Oversized buys charge only `amountInUsed`, not requested amount |
| 7 | Donation resistance | Direct LT donations to the pair don't trigger graduation and don't skew LP open price; donated LT stays locked in the curve pair |

After graduation, all trades continue through `Zap` via HyperSwap. The pool is TOKEN/LT so leveraged exposure persists.

---

## Fees & FeeVault

All fees are charged by `Zap` in USDC and forwarded into `FeeVault`. The router holds no fee state — the vault is where balances live and where creators and the protocol claim.

- **Rate:** 0.75% on every buy/sell (curve **and** post-grad), split 0.5% protocol / 0.25% creator.
- **Accrual:** `Zap` transfers the fee USDC to `FeeVault`, then calls `FeeVault.accrue(token, creator, creatorAmount, protocolAmount, isBuy)`. Creator attribution comes from `Bonding.tokenInfo(token).creator` (set at launch, updatable via `transferCreator`).
- **Claims:** `FeeVault.claim()` pays the caller their pooled USDC balance across every token they've launched. `FeeVault.claimProtocol()` is permissionless and pays the configured `feeTo` — anyone can trigger the payout, but funds always go to the admin-set address.
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
