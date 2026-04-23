# packages/contracts

Forked from Virtuals Protocol `contracts/fun`. Solidity 0.8.x, Foundry.

## What This Package Does

Bonding curve system where the reserve asset is a BounceTech Leveraged Token (LT) instead of USDC. Users interact via `LaunchpadRouter` which abstracts LT — they only see USDC in/out.

```
User → USDC → LaunchpadRouter → mint LT → Bonding.buy(..., trader=user) → FPair (token/LT) → token
Graduation → Bonding._graduate() → HyperSwap V2 pool (token/LT) → LP locked
```

## Router allowlist (`Bonding.isRouter`)

`Bonding.launch`, `Bonding.buy`, and `Bonding.sell` are gated on an allowlist:
only addresses in `_routers` (OZ `EnumerableSet.AddressSet`) may call them.
Manage via owner-only `addRouter` / `removeRouter`; query via `isRouter` or
`getRouters`. This (a) makes `LaunchpadRouter` the only trust-surface for
curve interactions, and (b) lets us hot-swap routers without downtime —
`addRouter(newRouter)` → flip the frontend constant → `removeRouter(oldRouter)`.

`Bonding.buy/sell` take a `trader` address which is emitted in `Bonding.Trade`
and used by the indexer / UI. Because only allowlisted routers can reach the
function, `trader` is trusted — `LaunchpadRouter` forwards `msg.sender` (the
real user EOA). Seed buys via `createToken` attribute to the creator.

## Contracts

| Contract | Description |
|---|---|
| `Bonding.sol` | Launch, buy, sell, graduation (dynamic LP seeding, dual trigger), fee collection |
| `FFactory.sol` | Pair registry, fee config (multi-LT via `PairCreated(lt)` + `ltFor` mapping) |
| `FRouter.sol` | AMM math, buy/sell execution with **overflow buy cap** |
| `FPair.sol` | Per-token pair: reserves, k-constant (asset-agnostic, no changes) |
| `FERC20.sol` | ERC20 token with owner-only burn |
| `LaunchpadRouter.sol` | USDC abstraction, LT mint/redeem, **overflow-LT refund**, referral events |
| `LPLock.sol` | Graduation LP lock (UUPS, no withdraw in v1) |

## Graduation — Dynamic LP Seeding (Read This Before Touching `_graduate`)

This is the most bespoke piece of the protocol. Full rationale + invariants live in [`docs/contracts-scope.md`](../../docs/contracts-scope.md#graduation); the short version:

- **Virtual token reserve.** At launch, `FPair.reserve0 = totalSupply (1B)` while only `curveSupply = 75%` (750M) of real tokens are transferred to the pair. The other 250M (`LP_RESERVE`) sit in `Bonding` for graduation. This extends the curve beyond the sellable supply, which is what makes dynamic LP seeding work cleanly.
- **Dual trigger.** Graduation fires on whichever hits first: `assetBalance × exchangeRate ≥ $12K` (USD, for LT pumps) or `IFPair.tokenBalance() == 0` (supply, for flat/bear markets).
- **Zero-gap LP seeding.** `_graduate` computes `tokensForLP = ltFromPair × reserve0 / reserve1` (the unique amount that makes the LP open at the last curve price), burns the remainder of the 250M reserve, and burns any unsold curve tokens.
- **Parabola invariant.** With `V_t_init = totalSupply` and `curveSupply = 75%`, the function `tokensForLP(sold) = sold·(S−sold)/S` peaks at `S/4 = LP_RESERVE`. The cap in `_graduate` is defensive — it can never bind in normal operation.
- **Overflow buy cap.** `FRouter.buy` caps `tokensOut` at the pair's real balance and back-calculates the LT consumed, so the last buy cannot exceed remaining supply. `LaunchpadRouter.buy` refunds the unused LT as USDC (or LT on fallback). `Bonding.buy` returns `(tokensOut, amountInUsed)` for this reason.

**If you change `_graduate`, `_prepareGraduationLiquidity`, `FRouter.buy`'s capping logic, or the seeding in `_deployAndSeed`:** you MUST re-run `test/GraduationInvariants.t.sol` and all 7 invariants must still pass. These invariants are the product — do not loosen their assertions to make a change go green.

## Functional Spec

Full requirements (buy/sell flows, graduation, events, fee structure): [`docs/contracts-scope.md`](../../docs/contracts-scope.md).
