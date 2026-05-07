# packages/contracts

Forked from Virtuals Protocol `contracts/fun`. Solidity 0.8.x, Foundry.

## What This Package Does

Bonding curve system where the reserve asset is a BounceTech Leveraged Token (LT) instead of USDC. Users interact via `Zap` which abstracts LT — they only see USDC in/out.

```
User → USDC → Zap → mint LT → Bonding.buy(..., trader=user) → Pair (token/LT) → token
Graduation → Bonding._graduate() → HyperSwap V2 pool (token/LT) → LP locked
```

For the LT interface and constraints (atomic-redeem-only, idle USDC buffer, `$10` minimum) see the BounceTech LT Integration section in the root [`AGENTS.md`](../../AGENTS.md#bouncetech-lt-integration). External references: [BounceTech docs](https://docs.bounce.tech/), [integration guide](https://docs.bounce.tech/technical/integration-guide), [contract source](https://github.com/bounce-tech/bounce-smart-contracts).

Atomic-redeem-only sells are an intentional v1 tradeoff. `Zap` does not implement `prepareRedeem` fallback queues; during LT idle-buffer depletion windows sells can revert and users are expected to retry in chunks after replenishment.

## Two "router" concepts — read this before touching either

The codebase has two distinct things called "router" and they have very different
upgrade properties. Conflating them is a real footgun:

1. **Zap (a.k.a. user-facing router) — hot-swappable.** `Zap` is the entry point
   gated by `Bonding._routers` (OZ `EnumerableSet.AddressSet`). `Bonding.launch`,
   `Bonding.buy`, and `Bonding.sell` revert unless `msg.sender` is on this
   allowlist. Manage via owner-only `addRouter` / `removeRouter`; query via
   `isRouter` or `getRouters`. This list is what the "hot-swap" story refers to:
   `addRouter(newZap)` → flip the frontend constant → `removeRouter(oldZap)`. No
   downtime, no per-token migration. `Zap` itself is also UUPS-upgradeable, so
   small changes can ship via implementation upgrade without touching the
   allowlist at all.
2. **`Router.sol` (AMM math, internal) — frozen at deploy.** This is the
   contract the curve `Pair`s actually call into. `Pair.router` is **immutable**,
   wired in `Pair`'s constructor from whatever `Factory.router` was at
   `Factory.createPair` time. `Factory.setRouter` is also one-shot:
   `if (pairCount > 0) revert RouterFrozen();` — once the first pair is created
   the factory's `router` field is permanent, so every future pair inherits the
   same address. `Router.sol` itself is **not** UUPS-upgradeable (no
   `UUPSUpgradeable` mixin, no `_authorizeUpgrade`, and the deploy script
   instantiates it directly via `new Router()` rather than behind an
   `ERC1967Proxy`). Replacing it therefore requires a fresh `Factory` + fresh
   `Router` + migrating every existing token, which is effectively a re-deploy.
   This is acceptable because `Router` holds no funds and no per-token state —
   it is pure AMM math against `Pair` reserves — but it is not "swappable" in
   any operational sense.

The "router" in the `Bonding._routers` allowlist refers to category (1); a
future rename to `_zaps` would remove the ambiguity but is a coordinated
breaking change (indexer + frontend) and has not been done.

`Bonding.buy/sell` take a `trader` address which is emitted in `Bonding.Trade`
and used by the indexer / UI. Because only allowlisted Zaps can reach the
function, `trader` is trusted — `Zap` forwards `msg.sender` (the
real user EOA). Seed buys via `createToken` attribute to the creator.

## Contracts

| Contract | Description |
|---|---|
| `Bonding.sol` | Launch, buy, sell, graduation (dynamic LP seeding, dual trigger), fee collection |
| `Factory.sol` | Pair registry, fee config (multi-LT via `PairCreated(lt)` + `ltFor` mapping) |
| `Router.sol` | AMM math, buy/sell execution with **overflow buy cap** |
| `Pair.sol` | Per-token pair: reserves, k-constant (asset-agnostic, no changes) |
| `Token.sol` | ERC20 token with owner-only burn |
| `Zap.sol` | USDC abstraction, LT mint/redeem, **overflow-LT refund**, referral events |
| `LPLock.sol` | Graduation LP lock (UUPS, no withdraw in v1) |

## Anti-snipe Launch Gate (Read This Before Touching `launch` or `buy`)

Issue #310. Two cooperating knobs eliminate the standard pump.fun-class first-block snipe:

- `Zap.MIN_SEED_USDC` (`$20`, real USDC, 6dp) — `Zap.createToken` reverts with `BelowMinSeed` for any smaller seed. Mandatory; the seed buy is no longer optional.
- `Bonding.LAUNCH_TRADING_DELAY_BLOCKS = 3` — `Bonding.buy` reverts with `TradingNotOpen` until `block.number > launchBlock + LAUNCH_TRADING_DELAY_BLOCKS`. The seed buy bypasses the gate via a transient-storage slot (`_SEED_BUY_BYPASS_SLOT`, EIP-1153 TLOAD/TSTORE) set in `launch()` and consumed on first match in `buy()`. Bypass is consume-once and naturally cleared at end-of-tx — separate-tx sniper buys at the same block see a cleared slot and revert.

Combined: the creator's seed absorbs the cheap end of the curve, and no public buy can land before `launchBlock + 4`. **No upper bound on the seed.** A cap would be trivially bypassable via a second wallet at `launchBlock + 4` and would block legitimate seed-and-burn patterns; the floor is the only side that protects retail. This is a deliberate design choice — see `Zap.MIN_SEED_USDC` natspec and `Bonding._enforceLaunchDelay`.

If you change either knob, update the threat-model writeup in the root [`AGENTS.md`](../../AGENTS.md#anti-snipe-design) and the frontend mirror (`MIN_USDC_BUY_AMOUNT` in [`packages/shared/src/constants/bouncetech.ts`](../shared/src/constants/bouncetech.ts) plus the disable check in [`apps/web/src/components/create/CreateView.tsx`](../../apps/web/src/components/create/CreateView.tsx)). Coverage: `test_buy_blockedDuringLaunchDelay`, `test_buy_blockedAtLastDelayBlock`, `test_buy_succeedsOnceDelayElapses`, `test_createToken_revertsBelowMinSeed`, `test_createToken_revertsZeroSeed`, `test_launchBlock_recorded` in `test/Zap.t.sol`.

## Graduation — Two-Phase, Dynamic LP Seeding (Read This Before Touching Graduation Code)

This is the most bespoke piece of the protocol. Full rationale + invariants live in [`docs/contracts-scope.md`](../../docs/contracts-scope.md#graduation); the short version:

- **Two-phase split.** Graduation is split across two transactions to fit HyperEVM's small-block (~2M gas) ceiling.
  - **Phase 1: `_enterGraduating`**, fired inline by the threshold-crossing buy (~150-200k of additional gas on top of the buy). Drains the curve, computes the LP-bound amounts, caches them in `pendingGraduation[token]`, flips `lifecycle: Curve → Graduating`, freezes trading. Emits `TokenGraduating`.
  - **Phase 2: `finalizeGraduation`**, **permissionless** big-block tx (~2.5M gas). Creates the HyperSwap pair if needed, mints LP via direct `pair.mint(lpLock)` (router-bypass), locks LP, flips `lifecycle: Graduating → Graduated`. Emits `TokenGraduated`. A Cloudflare Worker keeper handles the happy path; anyone can call to rescue a stuck token.
- **Brick resistance.** The phase-2 LP-seeding path bypasses the HyperSwap V2 router entirely (`pair.mint(lpLock)` directly). This makes the contract **immune to a front-runner pre-creating + dust-seeding the pair between phases** — under the previous `_requirePairEmpty` design that scenario was a permanent brick. Tested by `test_brick_resistance_frontRun_dust_seed` in [`test/TwoPhaseGraduation.t.sol`](test/TwoPhaseGraduation.t.sol).
- **Virtual token reserve.** At launch, `Pair.reserve0 = totalSupply (1B)` while only `curveSupply = 75%` (750M) of real tokens are transferred to the pair. The other 250M (`LP_RESERVE`) sit in `Bonding` for graduation. This extends the curve beyond the sellable supply, which is what makes dynamic LP seeding work cleanly.
- **Dual trigger.** Phase 1 fires on whichever hits first: `(storedAssetReserve - virtualLtReserve) × exchangeRate ≥ $12K` (USD, for LT pumps) or `IPair.tokenBalance() == 0` (supply, for flat/bear markets). The USD trigger reads STORED reserves so direct LT donations to the pair don't count toward the threshold; the launch-time `virtualLtReserve` is recovered on-the-fly as `Pair.k() / Token.TOTAL_SUPPLY()` (K is set once at mint and never modified by `Pair.swap`). The supply trigger reads live `tokenBalance()`, which is donation-resistant in the opposite direction: token donations only INCREASE the balance and can never satisfy `== 0`, and any donated tokens are unconditionally burned by `_prepareGraduationLiquidity`.
- **Zero-gap LP seeding.** `_prepareGraduationLiquidity` computes `ltFromPair = storedAssetReserve - virtualLtReserve` (the real LT raised by the curve, donation-immune; `virtualLtReserve` is derived from `Pair.k() / Token.TOTAL_SUPPLY()`) and `tokensForLP = ltFromPair × storedTokenReserve / storedAssetReserve` at end-of-phase-1, caching the result. Phase 2 uses the cached value verbatim, so the curve→LP price match is invariant under the tx split. Donated LT stays in the curve pair under the trust assumption that `BONDING_ROLE` is only ever held by `Bonding` and `Bonding` won't call `Router.graduate` again post-graduation.
- **Parabola invariant.** With `V_t_init = totalSupply` and `curveSupply = 75%`, the function `tokensForLP(sold) = sold·(S−sold)/S` peaks at `S/4 = LP_RESERVE`. The cap in `_prepareGraduationLiquidity` is defensive — it can never bind in normal operation.
- **Overflow buy cap.** `Router.buy` caps `tokensOut` at the pair's real balance and back-calculates the LT consumed, so the last buy cannot exceed remaining supply. `Zap.buy` refunds the unused LT as USDC (or LT on fallback). `Bonding.buy` returns `(tokensOut, amountInUsed)` for this reason.

**If you change `_enterGraduating`, `finalizeGraduation`, `_prepareGraduationLiquidity`, `_seedUniswapV2Direct` (or any of its `_seedRebalancingViaRouter` / `_routerRebalance` / `_routerDepositAndDispose` / `_noFeeSwapInput` helpers), `Router.buy`'s capping logic, or the seeding in `_deployAndSeed`:** you MUST re-run `test/GraduationInvariants.t.sol`, `test/TwoPhaseGraduation.t.sol`, `test/HostilePreSeed.t.sol`, and `test/NoFeeSwapInput.t.sol`. All 7 zero-gap invariants must still pass; the phase-1-fits-in-small-block budget assertion (1.8M) must still hold; the brick-resistance + attacker-no-profit tests must still pass. These invariants are the product — do not loosen their assertions to make a change go green.

## HyperSwap Router non-standard ABI (Read This Before Adding Any Router Call)

HyperSwap's mainnet V2 router (`0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A`) is **not** a vanilla `UniswapV2Router02`. The selector dispatch table omits every canonical swap function and replaces them with three FoT-only variants that take a non-standard `address referrer` argument inserted between `to` and `deadline`:

| Selector | Function (HyperSwap) | Canonical V2 equivalent (NOT exposed) |
|---|---|---|
| `0xac3893ba` | `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint,uint,address[],address,address,uint)` | `swapExactTokensForTokens(...)` (`0x38ed1739`) |
| `0xb4822be3` | `swapExactETHForTokensSupportingFeeOnTransferTokens(uint,address[],address,address,uint)` | `swapExactETHForTokens(...)` (`0x7ff36ab5`) |
| `0x52aa4c22` | `swapExactTokensForETHSupportingFeeOnTransferTokens(uint,uint,address[],address,address,uint)` | `swapExactTokensForETH(...)` (`0x18cbafe5`) |

**Calling the canonical selector reverts with no data** (selector not in the dispatch table → fallback). This was the root cause of issue #343's near-miss — the original PR called `router.swapExactTokensForTokens(...)` and would have bricked every hostile-pre-seed defense path on day one of mainnet.

**The protocol's rule: never call a swap function on the V2 router.** Both `Bonding._pairRebalance` (the hostile-pre-seed rebalance) and `Zap._swapOnUniswapV2` (post-grad user trades) go direct to the pair via `pair.swap(amount0Out, amount1Out, to, "")`. We compute the V2 fee-charging amount-out ourselves; the pair's K-invariant check enforces correctness. This is independent of HyperSwap's router quirks and works on any V2 fork.

What IS canonical on the HyperSwap router and safe to call:

- `factory()` (`0xc45a0155`) — used in `Deploy.s.sol` to derive the V2 factory address from the router constant.
- `addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)` (`0xe8e33700`) — canonical V2 signature. Used by `Bonding._routerDepositAndDispose` for the hostile-pre-seed defense's deposit leg, because the router's `quote()`-based optimal-split logic is non-trivial to reimplement and the function is verified canonical.
- `WETH()`, `quote()`, `getAmountsOut()`, `removeLiquidity*` family — all canonical, but the protocol doesn't currently use them.

The full deployed-router selector list (16 functions total) and the verification methodology (bytecode `PUSH4-EQ` extraction + `eth_call` empirical tests) is preserved in the issue #343 review history. To re-verify in the future:

```bash
R=0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A
cast code --rpc-url "$HYPEREVM_RPC_URL" $R | grep -oiE '63[0-9a-f]{8}14' | sort -u | sed 's/^63//;s/14$//'
```

[`packages/contracts/src/interfaces/IUniswapV2Router02.sol`](src/interfaces/IUniswapV2Router02.sol) deliberately exposes only `factory()` and `addLiquidity(...)` — the two methods we actually use AND that exist on the deployed router. If you need to add another, FIRST verify the selector via `cast code | grep` and add a comment with the empirical evidence.

[`test/mocks/MockHyperswapRouter.sol`](test/mocks/MockHyperswapRouter.sol) mirrors the HyperSwap surface: canonical `addLiquidity` plus the FoT-with-`referrer` token-token variant. The mock does NOT implement canonical `swapExactTokensForTokens` (matches reality), so any code that accidentally calls it will fail at test time with a clear "function not found" rather than only failing on production deploy.

## HyperSwap Pre-Seed Defense (Read This Before Touching `_seedUniswapV2Direct`)

Issue #308. The whole sub-system inside `_seedUniswapV2Direct` exists to defuse one specific attack class. It's the most subtle code in the package. Read this before touching any of the helpers (`_seedRebalancingViaRouter`, `_routerRebalance`, `_routerDepositAndDispose`, `_noFeeSwapInput`).

### The exploit

A vanilla UniswapV2 pair is deployable by anyone: `factory.createPair(token, lt)` is permissionless, and after creation anyone can call `pair.mint(to)` against pre-transferred tokens. So between phase 1 (`_enterGraduating` flips lifecycle to `Graduating` and caches `tokensForLP / ltFromPair`) and phase 2 (`finalizeGraduation` mints LP via `pair.mint(lpLock)`), an attacker can:

1. Front-run by calling `factory.createPair(token, lt)` themselves
2. `transfer(pair, smallToken)` and `transfer(pair, smallLT)` at any ratio they choose
3. Call `pair.mint(attacker)` — they now own LP at a hostile reserve ratio

When our `pair.mint(lpLock)` runs in phase 2 against this non-empty pair, V2's mint formula picks up the existing reserves:

```
liquidity = min(amount0 · totalSupply / reserve0, amount1 · totalSupply / reserve1)
```

The `min(...)` arm whose denominator is bigger relative to its numerator wins, and the OTHER arm's "excess" deposit is donated pro-rata to existing LP holders — i.e. to the attacker. Two harms:

- **Wrong opening price.** Post-mint reserves are `(R_attacker + T_a, R_attacker + T_b)`, so the LP opens at `(R_a + T_a) / (R_b + T_b)`, NOT at the curve close `T_a / T_b`. Pentest `IN-02` measured a 454 bps gap with a $15 LT pre-seed at 50% off curve close.
- **LP capture.** The wasted-side excess goes to the attacker's LP claim. Pentest `F-02` measured 34 bps of LP captured for a `1 wei + 1 LT` pre-seed (~$1 attack budget).

This is the same exploit class as the four.meme Feb 2025 incident (~$183K loss).

### Options we considered (and rejected)

The pentest's recommended fixes were either ineffective or worse than the disease:

1. **Pre-create the pair atomically inside `_deployAndSeed` at launch time.** Doesn't work. A V2 pair is just an empty contract until someone calls `mint()`; pre-creating prevents `factory.createPair` from being callable by an attacker, but the attacker can still `transfer + mint` against the empty pair we created. ~80k extra gas per launch for zero security.
2. **Detect skewed pre-existing reserves in `_seedUniswapV2Direct` and revert if the ratio diverges by more than N bps.** Re-introduces brick risk: an attacker can grief every graduation with $1 of dust per token. Forces ops to either (a) widen the bound enough that the attack survives, or (b) keep it tight and ship an admin escape hatch. We previously had `_requirePairEmpty` which had this exact problem and we removed it for that reason — `test_brick_resistance_frontRun_dust_seed` exists to prevent regression.
3. **Custom V2 pair with launchpad-specific `mint()` semantics.** Means forking the AMM. Breaks the "post-grad venue is HyperSwap" property in the root [`AGENTS.md`](../../AGENTS.md) — our pairs would no longer be real HyperSwap pairs, aggregators wouldn't pick them up. Architecturally unacceptable.
4. **Defensive bot only.** Off-chain race against the attacker to call `finalizeGraduation` first. Probabilistic, fails on bad gas estimation, and doesn't address the case where the attacker pre-seeded BEFORE the threshold-crossing buy lands. Insufficient.
5. **`router.addLiquidity(min=0, min=0)` instead of direct `pair.mint`.** The router does `quote()`-based optimal-split which avoids the `min()` donation, but it deposits at the pool's CURRENT ratio — i.e. preserves the attacker's hostile ratio. Pool still opens off curve close, attacker still extracts arbitrage value. Tight `min` brings back brick risk. Strictly worse than the option below.
6. **Same as (5) but with a swap to rebalance the pool first.** This is what we shipped (next section). The trick is recognising that you can't both fix the price AND deposit your full inventory — mass conservation forces a leftover that has to be disposed.

### What we shipped — the three-regime defense

`_seedUniswapV2Direct` branches on the pre-seed shape:

#### Regime 1 — empty pair (~99% of graduations)

Pristine path: `transfer(pair, tokensForLP) + transfer(pair, ltFromPair) + pair.mint(lpLock)`. Pool opens at exactly `ltFromPair / tokensForLP`, zero gap by construction. Bypasses the V2 router entirely. This is the original code; no behavioral change for honest graduations.

#### Regime 2 — pure-donation pre-seed

Attacker called `IERC20(token).transfer(pair, X)` without ever calling `pair.mint`. Reserves stay at zero; only the pair's balance moved. We call `pair.skim(lpLock)` first — V2's `skim` transfers excess balance over reserves to the recipient — so the donated tokens flow to LPLock as protocol revenue. Path then collapses to Regime 1.

#### Regime 3 — mint pre-seed (the actual exploit)

Attacker called `pair.mint(attacker)` against a self-funded dust seed. Reserves are non-zero at a hostile ratio. We:

1. **Compute the swap input** that would drive the pool ratio back to the curve-close ratio under the no-fee constant-product model: `s = sqrt(reserveIn · reserveOut · targetN / targetD) − reserveIn`, capped at our per-side budget. Implementation in `_noFeeSwapInput`. Closed-form via OZ `Math.sqrt + Math.mulDiv`; no binary search, no convergence loop.
2. **Execute the swap directly on the pair** via `pair.swap(amount0Out, amount1Out, address(this), "")`. We compute the V2 fee-charging amount-out ourselves and pass it as the output. **Bypasses the router** — HyperSwap's V2 router has no canonical `swapExactTokensForTokens` (see "HyperSwap Router non-standard ABI" above). Same direct-to-pair pattern Zap uses for post-grad user swaps. Implementation in `_pairRebalance`.
3. **Deposit the remaining inventory** via `router.addLiquidity(rest, 1, 1, lpLock, ...)`. The router's `quote()`-based optimal split deposits only the matched-ratio subset; neither side becomes a `min()` donation. Off-ratio remainder stays in `Bonding`. The router's `addLiquidity` IS canonical V2 on HyperSwap (verified selector `0xe8e33700`), so this leg is safe to keep on the router and gets the `quote()` math for free.
4. **Dispose the off-ratio remainder.** TOKEN side burned (`Bonding` is the Token owner). LT side auto-swept to the protocol owner by `finalizeGraduation`'s post-sweep — emits `LTRescued(lt, owner, amount)` for observability. See "Per-graduation LT isolation" below.

Why the **asymmetric router usage** (pair for swap, router for addLiquidity): the swap is unsafe to send through the router because HyperSwap's swap ABI is non-standard; the deposit IS safe because HyperSwap's `addLiquidity` ABI is canonical AND the `quote()`-based optimal-split logic is the part that defuses the LP-capture attack. We get the best of both — no HyperSwap-specific footgun on the swap, no reimplementation burden on the deposit.

Why the fourth step matters: **mass conservation prevents fixing both the price and the deposit.** If the pool starts off-target and our inventory is on-target, we cannot end with both at-target reserves AND a fully-deposited inventory — something has to absorb the imbalance. Step 4 is where it goes.

### Brick-resistance contract

`_seedUniswapV2Direct` MUST never revert under any pre-seed shape. The brick-resistance contract is the load-bearing security property — auditors prioritise it above the LP-capture defense, because a brick locks every holder in `Graduating` forever. The pre-seed defense is layered to honour this:

- **Regime 1/2 don't touch the router.** Even if the V2 router is misbehaving, the empty + donation paths run on direct pair calls.
- **`_pairRebalance` precondition-checks the swap.** `_noFeeSwapInput` may return a tiny `s` against an extremely imbalanced pool where V2's fee-charging `getAmountOut` rounds down to zero, which would revert `pair.swap` with `INSUFFICIENT_OUTPUT_AMOUNT`. We mirror V2's `(s · 997 · rOut) / (rIn · 1000 + s · 997)` formula and skip the swap if it would round to zero. Skipping is safe — the subsequent `addLiquidity` still defuses the LP-capture attack via `quote()`-based split, just opens at the (sub-bp) residual skew the swap would have closed.
- **`_routerDepositAndDispose` uses `min0=1, min1=1`.** Slippage protection on `addLiquidity` exists to defend against a third party moving the pool ratio between quote and execution; here we set the ratio ourselves in `_routerRebalance` in the same atomic tx, so there's no third party to defend against. The `=1` (rather than `=0`) trips V2's degenerate-ratio guard so the call can't silently land at near-zero.
- **No external dependency on the router slot being correct post-deploy.** `uniswapV2Router` is set at `initialize` time alongside `uniswapV2Factory` and is rejected if zero. There's no live setter — rotation requires a UUPS upgrade so the change is visible on-chain ahead of any in-flight graduation.

Tested end-to-end by `test_brickResistance_arbitraryPreSeed_finalizeAlwaysSucceeds` and the `testFuzz_arbitraryPreSeed_zeroGap` 64-run fuzz in `test/HostilePreSeed.t.sol`, plus the original brick-resistance regression tests in `test/TwoPhaseGraduation.t.sol`.

### Attacker P&L outcome

After the fix, the attacker holds LP at the curve-close ratio. The arbitrage-back-to-true-price step that the attacker wanted to extract from is gone (we already arb'd it during the rebalance, paying the V2 0.3% fee back to ourselves as ~99% LP holder via the pair's K-invariant accounting). Attacker's LP claim ≈ what they put in, modulo the `MINIMUM_LIQUIDITY` lock and a tiny share of the fee they paid. **Net P&L ≤ 0** — the attack is cost-negative. Asserted by `testFuzz_attacker_cannotProfit` over 64 random pre-seed shapes.

### Pool-open precision

`PRICE_MATCH_EPS_BPS = 50` in `test/HostilePreSeed.t.sol`. Honest graduations open at 0 bps gap (Regime 1, exact direct mint). Hostile-pre-seed graduations open within 50 bps — the structural ceiling is the V2 fee landing between rebalance and deposit (~30 bps) plus integer rounding in the router's `quote()`-based split (~10 bps). 50 bps is well inside "exploit denied" — arbitrage closes the gap within blocks and the attacker still loses pre-seed value. Documented in the assertion's natspec.

### Per-graduation LT isolation

`finalizeGraduation` snapshots `protectedLT = balanceOf(this) - p.ltFromPair` at the top: any LT in `Bonding` beyond this graduation's earmark is either another concurrent graduation's escrow (Phase 1 already moved it in via `Router.graduate`) or stray dust. Both must stay out of THIS graduation's LP and post-sweep.

That snapshot is plumbed through `_seedUniswapV2Direct` → `_seedRebalancing` → `_routerDepositAndDispose`, where the deposit allowance is capped at `balanceOf(this) - protectedLT`. Then a single `_sweepLTToOwner(lt, protectedLT)` at the end of `finalizeGraduation` sends only THIS graduation's rebalance residue to the protocol owner, leaving any concurrent-graduation escrow / stray dust untouched. Honest empty-pair graduations have no residue at the post-sweep so it's a no-op there.

Two scenarios this guards against:

- **Concurrent graduations on the same LT.** Two tokens A and B share an LT and both reach `Lifecycle.Graduating` before either finalizes (the keeper takes ~60s and popular LTs see overlap). Without `protectedLT`, A's finalize would treat the full balance as its own and either sweep B's escrow to the owner (bricking B's later finalize) or — for hostile-pre-seed graduations — deposit it into A's locked LP. With it, A only ever sees `ltFromPair_A` and B is preserved.
- **Cross-token LT residue (audit issue #11).** Old residue or a misdirected transfer sitting in `Bonding` would otherwise be visible to `_routerDepositAndDispose`'s `balanceOf(this)` read and could be silently consumed into a future graduation's locked LP. With `protectedLT`, contamination stays in `Bonding` and the deposit only sees this graduation's earmark.

The auto-sweep emits `LTRescued(lt, owner, amount)` for indexer observability. Coverage: `test_leftoverRecovery_autoSweptToOwnerOnFinalize`, `test_autoSweep_noOpOnHappyPath`, `test_concurrentGraduations_sameLT_doNotMixEscrows`, `test_strayLt_notConsumedByLaterGraduation_sameLT`.

### Mock-suite changes worth knowing

The defense exposed latent inaccuracies in `test/mocks/MockHyperswapRouter.sol` that were silently masked under the previous direct-mint code path. Fixed:

- `MockHyperswapPair.mint` enforces V2's `MINIMUM_LIQUIDITY = 1000` on first mint (locked to a `0xdead` sentinel since OZ ERC20 v5 rejects `_mint(address(0))`). Matches canonical V2.
- `MockHyperswapPair.skim` implemented (was missing entirely).
- `MockHyperswapRouter` rewritten to mirror the deployed HyperSwap surface specifically (see "HyperSwap Router non-standard ABI" above) — canonical `addLiquidity` + the FoT-with-`referrer` token-token variant; canonical `swapExactTokensForTokens` and `getAmountsOut` removed because the real router doesn't expose them. This means any test code that accidentally calls a canonical swap signature fails at compile time / "function not found" — the original PR #343 review caught a related bug because the mock had been faking canonical swap behaviour.
- `MockHyperswapPair`'s `setRouter` / `mintRaw` / `routerTransfer` / `setReserves` helpers removed — they only existed to support the now-deleted canonical-`swapExactTokensForTokens` mock implementation.

### Tests you MUST re-run if you change any of this

- `test/HostilePreSeed.t.sol` — 16 deterministic + 2 fuzz tests covering all 3 regimes, both swap directions, pentest scenarios `F-02` / `IN-02`, leftover recovery, brick resistance, phase-1 gas budget, and the attacker-no-profit invariant.
- `test/NoFeeSwapInput.t.sol` — 9 deterministic + 2 fuzz tests on the load-bearing math (degenerate inputs, monotonicity, cap-at-budget, closed-form correctness, overflow safety, the round-down-to-zero input shape that motivated the precheck).
- `test/TwoPhaseGraduation.t.sol` — original brick-resistance + phase-1-fits-in-small-block tests must still pass.
- `test/GraduationInvariants.t.sol` — zero-gap, supply conservation, parabola cap. Honest-path properties unchanged by the defense.

These invariants are the security contract — do not loosen their assertions to make a change go green.

## Functional Spec

Full requirements (buy/sell flows, graduation, events, fee structure): [`docs/contracts-scope.md`](../../docs/contracts-scope.md).

## Comment Style

These contracts will be audited and re-read by adversaries. Auditor attention is a finite resource — every paragraph of natspec is one less paragraph of attention on the next finding. Default to no comment, and earn each one.

**Keep:**

- Security-relevant invariants and the consequences of violating them (e.g. "tokens-for-LP ≤ LP_RESERVE is a mathematical invariant; the cap is a defensive guard").
- Front-run / DoS / MEV rationale (e.g. why a parameter is immutable, why a path bypasses the router, why a `try/catch` defuses a permit grief).
- Cross-system constraints that would break if violated (e.g. "must stay in sync with `vanity.ts`", "frontend / API replicate this length cap pre-flight").
- Numerical-encoding footguns (`uint256` vs `uint128` choices, scaling factors, BPS denominators).
- Non-obvious storage-layout requirements (see [Storage layout](#storage-layout) below — namespace IDs, slot pinning, append-only struct fields).
- Anything an auditor would reasonably ask "why this and not the obvious thing?" about.

**Cut:**

- Restatements of the function or variable name (`/// @notice Set the fee-to address`).
- Narration of the next line (`// Pull USDC from the user`).
- Standard pattern references when the code is plainly the standard pattern (don't cite "CEI" before every well-ordered function; don't explain UniswapV2 `transfer → swap` every time it appears).
- Re-derivations of content already in [root `AGENTS.md`](../../AGENTS.md), [`docs/contracts-scope.md`](../../docs/contracts-scope.md), or this file. Link to the canonical source instead.
- Doc strings that just describe what the next struct field obviously holds (`/// @dev The address of the recipient`).
- Per-getter natspec on trivial mappings already documented at the storage-variable declaration.
- "Existence check" / "see X for the rationale" comments that lead a reader through obvious control flow — early-return the obvious revert and trust the error name.

**Style:**

- Contract-level natspec orients a reader (one paragraph: what it is, what's load-bearing, where to look for the deep dive). Don't reproduce the spec.
- One source of truth: if a struct field's natspec already explains a width-choice rationale, the producing function shouldn't repeat it. Either link or stay silent.
- Section banners (`// ─── X ───`) are fine in long files (>300 lines, e.g. `Bonding.sol`, `Zap.sol`); drop them in short files.
- Errors should be self-documenting via their name (`UnknownLeveragedToken`, `LockerAlreadyAdded`). Add an `@dev` only when the trigger condition isn't obvious from the name.

## Storage layout

All four UUPS-upgradeable contracts (`Bonding`, `Zap`, `FeeVault`, `LPLock`) use [ERC-7201](https://eips.ethereum.org/EIPS/eip-7201) namespaced storage. There are **no `__gap` arrays** anywhere — adding state never requires arithmetic on a gap-length constant.

| Contract | Namespace | Slot |
|---|---|---|
| `Bonding` | `altfun.storage.Bonding` | `0x8b5754e13e604f53718538385c40d9546a4725ba57a2e3447377e5a0d65c8e00` |
| `Zap` | `altfun.storage.Zap` | `0x6efaff3d1fa34cdc0d13358102d3377232e1768dd473564521de8a1148608500` |
| `FeeVault` | `altfun.storage.FeeVault` | `0xa926bb40d5eda4681728c5a36d6763beef85e2d2279081fc5cff7e744da2d700` |
| `LPLock` | `altfun.storage.LPLock` | `0x57e36a555d9dab2c98f4867e0f00fcc9beedb947224d36563fd15d5248644d00` |

[`test/StorageLayout.t.sol`](test/StorageLayout.t.sol) recomputes each slot from its namespace string and asserts equality with the in-source constant — drift in either side fails CI before any other test runs.

**Rules when adding state:**

1. Add the field to the existing `<Contract>Storage` struct **at the end** (don't reorder, don't insert in the middle — same constraint as gapped layouts had, just without the bookkeeping).
2. State lives **only** in the namespaced struct. Constants and immutables stay at file scope (they're not in storage so the rule doesn't apply).
3. If you need a public accessor for a field, write an explicit getter — the namespaced struct fields can't be `public`.
4. **Never change a namespace string** on a deployed contract. The slot is hashed from the string; a one-character change relocates every field and bricks the proxy. If you genuinely need a new layout, design a fresh namespace (e.g. `altfun.storage.BondingV2`) and write a `reinitializer` that migrates the relevant slots.
5. OZ parents (`OwnableUpgradeable`, `Initializable`, `UUPSUpgradeable`, `Ownable2StepUpgradeable`) already use ERC-7201 internally with their own `openzeppelin.storage.*` namespaces, so they cannot collide with ours.

**External ABI:** the migration preserves every public getter signature. Mappings of structs (`pendingGraduation`, `LPLock.locks`) keep their tuple-returning shape via explicit getters that mirror what the auto-generated public-mapping getter used to produce — indexer / frontend bindings are byte-identical.

## Deploying to HyperEVM

Run from `packages/contracts`. Requires `.env` with `DEPLOYER_PRIVATE_KEY` and `HYPEREVM_RPC_URL`.

```bash
# 1. (one-time per wallet) opt deployer into big blocks — required for anything > ~2M gas
node scripts/toggle-big-blocks.mjs on

# 2. fresh build (avoids stale artifacts after renames/rewrites)
forge clean && forge build

# 3. broadcast — `--slow` is mandatory because txs depend on prior deployments
forge script script/Deploy.s.sol:Deploy --rpc-url "$HYPEREVM_RPC_URL" --broadcast --slow

# 4. (optional but recommended) flip back to small blocks so future config tx's confirm in 1s
node scripts/toggle-big-blocks.mjs off
```

After it completes (`ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.`):

1. Copy the addresses from `== Logs ==` into [`packages/shared/src/constants/addresses.ts`](../shared/src/constants/addresses.ts).
2. Update [`packages/shared/src/constants/chains.ts`](../shared/src/constants/chains.ts) `BONDING_START_BLOCK` to the lowest receipt block from `broadcast/Deploy.s.sol/999/run-latest.json` so the indexer doesn't replay history before our contracts existed.
3. Update the `DEFAULT_BONDING` / `DEFAULT_ZAP` constants in [`script/E2ETest.s.sol`](script/E2ETest.s.sol).
4. Re-export ABIs and rebuild shared so consumers see the new addresses:
   ```bash
   npm run export-abi --workspace @launchpad/contracts
   npm run build --workspace @launchpad/shared
   ```
5. Run `npm run typecheck && npm run lint && npm run test && npm run build` from the repo root.
6. Sanity-check wiring on-chain (see "Post-deploy sanity checks" below).

### HyperEVM gotchas (read this BEFORE deploying)

HyperEVM is **not** a vanilla EVM RPC — these things will burn time if you skip them:

- **Dual block dispatch.** Small blocks ≈2M gas / ~1s, big blocks ≈30M gas / ~60s. `Deploy.s.sol` includes contracts that exceed 2M gas individually (`Bonding`, `Zap`), so the broadcast WILL fail with `error code -32603: exceeds block gas limit` until you opt in. The opt-in is **per-wallet, persists**, lives on the Hyperliquid L1 (NOT EVM), and applies to **every** subsequent tx from that wallet (1s → 60s confirmations). Tooling: `scripts/toggle-big-blocks.mjs` (status / on / off) — uses Hyperliquid's `evmUserModify` L1 action with the `Agent`/phantom-agent EIP-712 signing scheme (NOT the user-signed-action scheme; do not copy from random Hyperliquid SDK examples without reading `sign_l1_action`).
- **Slow broadcasts.** With big blocks on, a full `Deploy.s.sol` is ~14–19 sequential txs × ~60s = **15–20 minutes**. Plan accordingly. Use `--slow` so forge waits for confirmations between dependent txs (it would hit nonce/state mismatches without it).
- **`--legacy` is NOT needed.** HyperEVM supports EIP-1559; the past broadcasts in `broadcast/Deploy.s.sol/999/` confirm this.
- **EVM version is pinned to Cancun.** `foundry.toml` sets `evm_version = "cancun"` to match HyperEVM (Cancun without blobs, per the [Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm)). Don't downgrade to Shanghai/Paris — solc would still emit Cancun-safe bytecode, but the explicit pin documents intent and unlocks `MCOPY` / transient storage if a future contract needs them.
- **Verification.** No public Etherscan-equivalent — `forge verify-contract` doesn't apply. `cast call` is the source of truth (see the sanity-check block in the deploy section above).
- **Chain ID is `999`.** RPC: `https://rpc.hyperliquid.xyz/evm` (or any provider; `.env` uses Alchemy).

### Post-deploy sanity checks

These read on-chain state and confirm the wiring set up by `_deploy()` actually landed:

```bash
set -a && source .env && set +a
B=<bonding_proxy>; F=<factory>; R=<router>; Z=<zap_proxy>
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "tokenImplementation()(address)"   # = Token impl
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "factory()(address)"               # = Factory
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "router()(address)"                # = Router
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "isRouter(address)(bool)" $Z       # = true
cast call --rpc-url "$HYPEREVM_RPC_URL" $Z "bonding()(address)"               # = Bonding proxy
cast call --rpc-url "$HYPEREVM_RPC_URL" $F "router()(address)"                # = Router
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "owner()(address)"                 # = deployer
```

