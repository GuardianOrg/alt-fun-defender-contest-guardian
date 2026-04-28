# apps/indexer

Ponder EVM indexer. Indexes on-chain events from Alt Fun contracts and HyperSwap V2 pools.

## Events Indexed

| Event | Contract |
|---|---|
| `TokenLaunched` | Bonding — also defensively bootstraps the `protocolConfig` singleton on first sight |
| `Trade` | Bonding (unified buy/sell with `isBuy` flag) |
| `TokenGraduated` | Bonding — includes `tokensInLP`, `lpBurned`, `unsoldBurned` (dynamic LP seeding outputs, see `packages/contracts/AGENTS.md`) |
| `GraduationThresholdUpdated` | Bonding — owner tweaked `graduationThresholdUsd`; upserts the `protocolConfig` singleton |
| `CreatorFeesClaimed` | Bonding |
| `ProtocolFeesClaimed` | Bonding |
| `Buy` | Zap — also bumps `token.organicUsdcRaised` and `token.volumeUsd` |
| `Sell` | Zap — also decrements `token.organicUsdcRaised` (floored at 0) and bumps `token.volumeUsd` |
| `Referred` | Zap |
| `Transfer` | Token (factory-registered via `TokenLaunched`) |
| `Swap` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |
| `Sync` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |

### Graduation progress decomposition (`token.organicUsdcRaised`)

Powers the "organic buys vs LT price appreciation" split on the landing-page progress bar. Cumulative net USDC (6dp) that has flowed through Zap for a given token — buys add `usdcIn`, sells subtract `usdcOut`. **Floored at 0** so a late-life sell-off can't produce negative organic.

The API (`apps/api/src/lib/token-enrich.ts`) reads this alongside the current `ltReserve × exchangeRate` value and derives:

- `curveFilled` = `max(supplyFilled, usdFilled)` (whichever trigger is closer to firing).
- `curveFilledOrganic` = `min(organicUsdcRaised / graduationThresholdUsd × 100, curveFilled)`.
- `curveFilledLeverageBoost` = `max(curveFilled − curveFilledOrganic, 0)` — never surface a negative boost (product decision: this is a marketing number, not an accounting figure).

`graduationThresholdUsd` is read from the `protocolConfig` singleton (see below). The API caches it per-isolate for 60s and falls back to the compile-time `12_000` if the row is missing — so an indexer outage just means the curve bar uses the launch-time default, not "unknown".

When you modify `Zap.Buy`/`Sell` handlers, **also keep the organic counter in sync**. The test suite in `apps/indexer/test/bonding.test.ts` asserts both the `routerTrade` insert and the counter bump.

### Protocol config singleton (`protocolConfig`)

Mirror of owner-tunable `Bonding` parameters. Currently a single column (`graduationThresholdUsd`, 18-dp wei); structured as a singleton row keyed `id = "global"` so additional tunables can be added without schema churn. Two write paths:

- `Bonding:GraduationThresholdUpdated` handler: `onConflictDoUpdate` — admin tweaks always overwrite.
- `Bonding:TokenLaunched` handler: `onConflictDoNothing` — defensive bootstrap to seed the row on a fresh indexer DB pointed at a freshly-deployed contract that hasn't yet emitted a threshold update. **Must stay no-op-on-conflict** so a subsequent launch doesn't clobber a real admin tweak.

Consumers (the API) treat a missing row as "use the compile-time default" rather than "unknown", which keeps the curve-filled progress bar populated during indexer outages and on cold starts before the bootstrap fires.

### Lifetime trading volume (`token.volumeUsd`)

Separate gross counter, bumped on **both** `Buy` and `Sell` (never subtracts). Surfaced as `totalVolumeUsd` on the API's token responses — different semantics from `organicUsdcRaised` (net, floored at 0) and from `volume24hUsd` (windowed, indexer-queried per request and can go null on pagination truncation). Sourced from the same `usdcIn` / `usdcOut` event fields as the organic counter, so keep them synced in the same `db.update` call.

### `curveSupply` / `ltReserve` are VIRTUAL AMM reserves

`token.curveSupply` and `token.ltReserve` (and the same columns on `trade` / `tokenSnapshot`) are persisted verbatim from `Bonding.Trade.newCurveSupply` / `newLtReserve`, which come from `IPair.getReserves()` — the **virtual** reserves the constant-product AMM uses. Under the dynamic-LP design:

- `curveSupply` (reserve0) is initialised to `TOTAL_SUPPLY` (1B × 1e18) and floors at `LP_RESERVE_RAW` (250M × 1e18) at full sellout. It's **not** "real remaining curve supply" — range is [250M, 1B], not [0, 750M].
- `ltReserve` (reserve1) is initialised to `virtualLtAtLaunch = $4K / rate_at_launch` and grows with buys. It's **not** "real LT raised" — at launch it's already non-zero.

These values are correct and needed unmodified for chart pricing (`ratio = ltReserve / curveSupply` is the on-curve price). Any consumer that wants real balances (e.g. graduation-progress math) has to convert using the token's `k`:

- `realRemaining = max(0, reserve0 − LP_RESERVE_RAW)` → matches `IPair.tokenBalance()`.
- `virtualLtAtLaunch = k / TOTAL_SUPPLY`, then `realLt = max(0, reserve1 − virtualLtAtLaunch)` → matches `IPair.assetBalance()`.

See `apps/api/AGENTS.md` and `apps/api/src/lib/token-enrich.ts` for the conversion in practice.

### Factory Registration (Dynamic Contract Subscriptions)

**Token clones** are deployed when a token launches. The `Token` contract source uses `factory` config pointing at the Bonding contract's `TokenLaunched` event. When `TokenLaunched` fires, Ponder extracts the `token` parameter and begins indexing `Transfer` events. The handler in `src/bonding.ts` writes to the `tokenBalance` table.

**HyperSwap V2 pairs** are created when a token graduates. The `HyperSwapPair` contract source uses `factory` config pointing at the Bonding contract's `TokenGraduated` event. When `TokenGraduated` fires, Ponder extracts the `pairAddress` parameter and begins indexing `Swap` and `Sync` events. Handlers in `src/hyperswap.ts` write to the `swap` and `pairReserve` tables.

ABIs imported from `@launchpad/shared`. Full indexing spec in `docs/backend-scope.md`.

### Post-graduation reserve mirror (`HyperSwapPair:Sync`)

After a token graduates, `Bonding.Trade` no longer fires — all trading moves to HyperSwap V2. To keep `token.curveSupply` / `token.ltReserve` (and the `tokenSnapshot` history that powers the chart and 24h-change math) live for graduated tokens, the `HyperSwapPair:Sync` handler does a three-step mirror on every emitted Sync:

1. Upsert `pairReserve` (raw `(reserve0, reserve1)` keyed by pair address — independent of the token mapping so it stays useful for debugging even when the index is missing).
2. Look up `hyperswapPairIndex` (populated at `TokenGraduated` time) to resolve `(tokenAddress, ltAddress, tokenIsToken0)` in O(1) without an RPC read of `token0()`. If the row is absent (e.g. the very first Sync at LP-seed time, before `TokenGraduated` registers the pair as a factory contract) the rest of the mirror is a no-op — that's fine because dynamic LP seeding makes the first post-grad price equal to the last curve price, so the curve-phase reserves stay correct until the next user trade.
3. Map `(reserve0, reserve1)` → `(tokenReserve, ltReserve)` via the cached `tokenIsToken0`, write them onto `token.curveSupply` / `token.ltReserve`, and append a `tokenSnapshot` row keyed `sync-${txHash}-${logIndex}`. The `sync-` prefix avoids ID collisions with the `Bonding.Trade` snapshots that share the same primary key space.

A live `trade` WS event is also emitted (skipped during backfill) carrying just `(tokenAddress, curveSupply, ltReserve, id, timestamp)` so `useChartData` rolls the in-progress candle. This is the **chart-state variant** of `TradeBroadcast` — it deliberately omits the trade-list payload (`usdcAmount` / `trader` / `isBuy` / `tokenAmount`). The trade-feed UI keys off `usdcAmount` presence, so chart-only broadcasts never surface as rows. Trade-list rows for post-grad swaps come from the `Zap:Buy` / `Zap:Sell` broadcasts (which fire alongside the swap in the same tx) plus the REST `/api/v1/trades` poll fallback (sourced from `routerTrade`, which covers both phases).

#### Reusing `token.curveSupply` / `token.ltReserve` post-graduation

The columns are deliberately reused (rather than adding `hyperswapTokenReserve` / `hyperswapLtReserve`) so every consumer that already reads token reserves (`computeTokenPrice` for price/mcap, the change24h calculation against `tokenSnapshot`, the `/chart` ratio timeline) keeps working without graduation special-casing. The `computeCurveFilledBreakdown` path short-circuits on `graduated === true`, so the supply-percent math (which assumes the values are *virtual* AMM reserves bounded `[250M, 1B]`) doesn't run for graduated tokens — safe to overwrite with HyperSwap's *real* reserves.

## Local dev port discipline

`ponder dev` defaults to port `42069` and **silently falls back** to the next
free port (`42070`, …) if it's taken. The API reads
`PONDER_URL=http://localhost:42069` from `apps/api/.dev.vars`, so a fallback
means the API talks to whatever was on `42069` — usually a stale `ponder dev`
from a previous session whose PGlite has since closed — producing a silent
"loading forever" UX with no obvious error.

To prevent this we wrap `ponder dev` with `scripts/dev.mjs`, which fails fast
(non-zero exit, surfaced by turbo) when `42069` is already bound and prints
the offending PID. If you ever see the wrapper bail, kill the squatter:

```sh
lsof -ti :42069 | xargs kill -9
```

The API side has a matching guard: `checkPonderHealth` queries an actual
table (`protocolConfig`) rather than `{ __typename }`, so a Ponder with a
crashed DB is reported `degraded` instead of `healthy`. Keep both guards in
lockstep — bypassing one lets the failure mode return.

## Hosting

Hosted on Railway (persistent process). Dockerfile in this directory. Railway auto-deploys from `main` via GitHub integration (with "Wait for CI" enabled). Railway env vars:
- `DATABASE_URL` — Neon PostgreSQL connection string (shared with API; Ponder isolates into its own schema)
- `PONDER_RPC_URL_999` — Alchemy HyperEVM RPC
- `BONDING_START_BLOCK` — block number of contract deployment (defaults to value in `@launchpad/shared`)
