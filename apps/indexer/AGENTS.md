# apps/indexer

Ponder EVM indexer. Indexes on-chain events from Alt Fun contracts and HyperSwap V2 pools.

## Events Indexed

| Event | Contract |
|---|---|
| `TokenLaunched` | Bonding — also bumps `globalStats.totalTokens` / `tokensLive` |
| `Trade` | Bonding (unified buy/sell with `isBuy` flag) |
| `TokenGraduated` | Bonding — includes `tokensInLP`, `lpBurned`, `unsoldBurned` (dynamic LP seeding outputs, see `packages/contracts/AGENTS.md`); also moves the token from `tokensLive` → `tokensGraduated` on `globalStats` |
| `CreatorFeesClaimed` | Bonding |
| `ProtocolFeesClaimed` | Bonding |
| `Buy` | Zap — also bumps `token.organicUsdcRaised`, `token.volumeUsd`, `globalStats.totalVolumeUsd`, the matching `hourlyVolume` bucket, and the buyer's `walletPosition` (cost basis) |
| `Sell` | Zap — decrements `token.organicUsdcRaised` (floored at 0); bumps `token.volumeUsd`, `globalStats.totalVolumeUsd`, the matching `hourlyVolume` bucket; reduces the seller's `walletPosition` cost basis proportionally |
| `Referred` | Zap |
| `Transfer` | Token (factory-registered via `TokenLaunched`) |
| `Sync` | HyperSwap V2 Pair (graduated pairs only, factory-registered) — see *One handler per factory source* below for why `Swap` is deliberately not subscribed |

### Platform-wide counters (`globalStats`, `hourlyVolume`, `walletPosition`)

Three derived tables exist solely to serve high-traffic API routes in O(1) instead of paginating up to 20K trades per request (issue #397):

- **`globalStats`** — singleton row keyed `"global"`. Tracks `totalTokens` / `tokensLive` / `tokensGraduated` (mirrors the legacy `/stats` decomposition: `live = total − graduated`) and `totalVolumeUsd` (lifetime gross USDC routed through Zap, never subtracts). Bootstrapped on the first `TokenLaunched` (or the first `Zap.Buy` if events ever arrive out of order). Read by `GET /api/v1/stats`.
- **`hourlyVolume`** — one row per hour-start Unix timestamp (`floor(ts/3600) * 3600`). Bumped on every `Zap.Buy` / `Zap.Sell` so `/stats` can derive `volume24h` from a 24-row scan. Storage grows at ~24 rows/day forever; the API only reads the last 25 buckets.
- **`walletPosition`** — `(wallet, token)` keyed (`id = "${wallet}-${tokenAddress}"`). Tracks `zapTokenAmount` (cumulative Zap-mediated buys − sells, floored at 0) and `costBasisUsdc` (cumulative USDC paid, reduced proportionally on each sell using the same FIFO-equivalent math the old `/portfolio` route did in memory). **Independent from `tokenBalance`** — `tokenBalance` mirrors every ERC-20 Transfer, while `walletPosition` only fires on Zap events. A wallet that received tokens via direct Transfer correctly shows a positive `tokenBalance.balance` with `walletPosition.costBasisUsdc = 0`. Read by `GET /api/v1/portfolio`.

When you modify the `Zap.Buy` / `Zap.Sell` handlers, **also keep these counters in sync** — the test suite in `apps/indexer/test/bonding.test.ts` asserts the singleton bump, the bucket upsert, and the `walletPosition` cost-basis math.

### Graduation progress decomposition (`token.organicUsdcRaised`)

Powers the "organic buys vs LT price appreciation" split on the landing-page progress bar. Cumulative net USDC (6dp) that has flowed through Zap for a given token — buys add `usdcIn`, sells subtract `usdcOut`. **Floored at 0** so a late-life sell-off can't produce negative organic.

The API (`apps/api/src/lib/token-enrich.ts`) reads this alongside the current `ltReserve × exchangeRate` value and derives:

- `curveFilled` = `clamp(usdFilled, 0, 100)` where `usdFilled = realLt × rate / graduationThresholdUsd × 100`. The supply trigger remains a bear-market backstop in the contract but does not influence the API's progress headline (using `max(supplyFilled, usdFilled)` made fresh tokens look multiples further along under the constant-product AMM than the user-paid dollars represented).
- `curveFilledOrganic` = `min(organicUsdcRaised / graduationThresholdUsd × 100, curveFilled)` — clamp keeps a late-life LT crash from producing negative leverage.
- `curveFilledLeverageBoost` = `max(0, curveFilled − curveFilledOrganic)` — never surface a negative boost (product decision: this is a marketing number, not an accounting figure).

`graduationThresholdUsd` is set once at `Bonding.initialize` (no on-chain setter). The API reads it directly from the contract via RPC and caches per-isolate for 60s; falls back to the compile-time `9_000` from `@launchpad/shared` on RPC outage. The indexer no longer mirrors this value — see `apps/api/AGENTS.md`.

When you modify `Zap.Buy`/`Sell` handlers, **also keep the organic counter in sync**. The test suite in `apps/indexer/test/bonding.test.ts` asserts both the `routerTrade` insert and the counter bump.

### Lifetime trading volume (`token.volumeUsd`)

Separate gross counter, bumped on **both** `Buy` and `Sell` (never subtracts). Surfaced as `totalVolumeUsd` on the API's token responses — different semantics from `organicUsdcRaised` (net, floored at 0) and from `volume24hUsd` (windowed, indexer-queried per request and can go null on pagination truncation). Sourced from the same `usdcIn` / `usdcOut` event fields as the organic counter, so keep them synced in the same `db.update` call.

### `curveSupply` / `ltReserve` are VIRTUAL AMM reserves

`token.curveSupply` and `token.ltReserve` (and the same columns on `trade` / `tokenSnapshot`) are persisted verbatim from `Bonding.Trade.newCurveSupply` / `newLtReserve`, which come from `IPair.getReserves()` — the **virtual** reserves the constant-product AMM uses. Under the dynamic-LP design:

- `curveSupply` (reserve0) is initialised to `TOTAL_SUPPLY` (1B × 1e18) and floors at `LP_RESERVE_RAW` (250M × 1e18) at full sellout. It's **not** "real remaining curve supply" — range is [250M, 1B], not [0, 750M].
- `ltReserve` (reserve1) is initialised to `virtualLtAtLaunch = $3K / rate_at_launch` and grows with buys. It's **not** "real LT raised" — at launch it's already non-zero.

These values are correct and needed unmodified for chart pricing (`ratio = ltReserve / curveSupply` is the on-curve price). Any consumer that wants real balances (e.g. graduation-progress math) has to convert using the token's `k`:

- `realRemaining = max(0, reserve0 − LP_RESERVE_RAW)` → matches `IPair.tokenBalance()`.
- `virtualLtAtLaunch = k / TOTAL_SUPPLY`, then `realLt = max(0, reserve1 − virtualLtAtLaunch)` → matches `IPair.assetBalance()`.

See `apps/api/AGENTS.md` and `apps/api/src/lib/token-enrich.ts` for the conversion in practice.

### Factory Registration (Dynamic Contract Subscriptions)

**Token clones** are deployed when a token launches. The `Token` contract source uses `factory` config pointing at the Bonding contract's `TokenLaunched` event. When `TokenLaunched` fires, Ponder extracts the `token` parameter and begins indexing `Transfer` events. The handler in `src/bonding.ts` writes to the `tokenBalance` table.

**HyperSwap V2 pairs** are created when a token graduates. The `HyperSwapPair` contract source uses `factory` config pointing at the Bonding contract's `TokenGraduated` event. When `TokenGraduated` fires, Ponder extracts the `pairAddress` parameter and begins indexing `Sync` events (only — see *One handler per factory source* below for why `Swap` is deliberately not subscribed). The handler in `src/hyperswap.ts` writes to the `pairReserve` table and mirrors live HyperSwap reserves into `token.curveSupply` / `token.ltReserve`.

ABIs imported from `@launchpad/shared`. Full indexing spec in `docs/backend-scope.md`.

#### One handler per factory source (Ponder 0.16 real-time bug workaround)

Every Ponder source whose `address` is a `factory(...)` (currently `Token` and `HyperSwapPair`) **must register exactly one `ponder.on` handler**. Adding a second event handler on a factory source silently breaks post-deploy indexing for every newly-discovered child contract — they never get persisted to `ponder_sync.factory_addresses` and any fresh deploy (per-deploy schema, see PR #905) loses access to them entirely.

Root cause: in `node_modules/ponder/dist/esm/sync-realtime/index.js`, the realtime sync builds its `factories` array by pushing `eventCallback.filter.address` for every event callback, with no dedup. Two events on the same factory source share the same `address` object reference (set once per source at config-build time), so the array contains the same factory object twice. The `filterBlockEventData` loop iterates that array and on the second pass for the same factory hits its own self-deletion branch:

```js
for (const factory of factories) {
  const factoryId = factory.id;
  for (const address of blockChildAddresses.get(factory)!) {
    if (childAddresses.get(factoryId)!.has(address) === false) {
      // first pass: NEW → add to in-memory map, keep in blockChildAddresses
      childAddresses.get(factoryId)!.set(address, hexToNumber(block.number));
    } else {
      // second pass: SAME factory.id → already in map → DELETE from blockChildAddresses
      blockChildAddresses.get(factory)!.delete(address);
    }
  }
}
```

End state: the per-block `childAddresses` map is empty for the duplicated factory. On finalization the empty map is written → no `factory_addresses` row → `ponder_sync.intervals` advances anyway → next deploy's backfill `getRequiredIntervals` thinks the range is fully synced and skips re-extraction → the child address stays unknown forever.

Historical sync dedupes by `factory.id` (`sync-historical/index.js` ~L240, `factoryIntervalsById = new Map(); ...`); real-time does not — the asymmetry was the bug. `apps/indexer/test/single-handler-per-factory.test.ts` locks the invariant by enumerating every registered handler and asserting each name in `FACTORY_SOURCE_NAMES` has exactly one. Add new factory sources to that list when you add them to `ponder.config.ts`.

If you genuinely need per-event data on a factory source (e.g. per-`Swap` data), derive it from the router-level events (`Zap:Buy` / `Zap:Sell` for our case) or compute it from `Sync` reserve deltas — do not subscribe a second event on the factory source.

#### Source factory events from the typed ABI, never `parseAbiItem` strings

Factory subscriptions in `ponder.config.ts` resolve their `event` field with `getAbiItem({ abi: BondingAbi, name: "..." })` rather than the more concise `parseAbiItem("event Foo(address indexed bar)")`. This is deliberate — the topic0 hash Ponder uses to filter logs is derived from the AbiEvent's parameter list, and a single drift between the hand-rolled string and the real Solidity event silently produces the **wrong topic0**. The factory log filter then matches zero logs, the dynamically-spawned source's handlers never fire, and downstream tables (`tokenBalance` for `Token`, `pairReserve` for `HyperSwapPair`) silently stay empty with no error surfaced anywhere — the regression behind issue #418, where one extra trailing `uint256 index` parameter on the `TokenLaunched` signature broke `/holders`, `/balances`, `/portfolio`, and the `creatorHoldingPct` security field for every token in production. `apps/indexer/test/ponder-config.test.ts` locks this contract by asserting the configured factory event's topic0 equals the real `BondingAbi` event's topic0.

### Post-graduation reserve mirror (`HyperSwapPair:Sync`)

After a token graduates, `Bonding.Trade` no longer fires — all trading moves to HyperSwap V2. To keep `token.curveSupply` / `token.ltReserve` (and the `tokenSnapshot` history that powers the chart and 24h-change math) live for graduated tokens, the `HyperSwapPair:Sync` handler does a three-step mirror on every emitted Sync:

1. Upsert `pairReserve` (raw `(reserve0, reserve1)` keyed by pair address — independent of the token mapping so it stays useful for debugging even when the index is missing).
2. Look up `hyperswapPairIndex` (populated at `TokenGraduated` time) to resolve `(tokenAddress, ltAddress, tokenIsToken0)` in O(1) without an RPC read of `token0()`. If the row is absent (e.g. the very first Sync at LP-seed time, before `TokenGraduated` registers the pair as a factory contract) the rest of the mirror is a no-op — that's fine because dynamic LP seeding makes the first post-grad price equal to the last curve price, so the curve-phase reserves stay correct until the next user trade.
3. Map `(reserve0, reserve1)` → `(tokenReserve, ltReserve)` via the cached `tokenIsToken0`, write them onto `token.curveSupply` / `token.ltReserve`, and upsert a `tokenSnapshot` row keyed `sync-bucket-${tokenAddress}-${blockTs}` (one row per `(token, second)` — see *Per-second snapshot decimation* below). The `sync-bucket-` prefix avoids ID collisions with the `Bonding.Trade` snapshots that share the same primary key space.

A live `trade` WS event is also emitted (skipped during backfill) carrying just `(tokenAddress, curveSupply, ltReserve, id, timestamp)` so `useChartData` rolls the in-progress candle. This is the **chart-state variant** of `TradeBroadcast` — it deliberately omits the trade-list payload (`usdcAmount` / `trader` / `isBuy` / `tokenAmount`). The trade-feed UI keys off `usdcAmount` presence, so chart-only broadcasts never surface as rows. Trade-list rows for post-grad swaps come from the `Zap:Buy` / `Zap:Sell` broadcasts (which fire alongside the swap in the same tx) plus the REST `/api/v1/trades` poll fallback (sourced from `routerTrade`, which covers both phases).

#### Per-second snapshot decimation (issue #978)

The `tokenSnapshot` upsert at step 3 is decimated to **at most one row per `(tokenAddress, blockTimestamp)`**. HyperSwap V2's `Sync` fires on every reserve change — post-swap state, MEV bot tail-swaps inside the same block, multi-step arbitrage — and pre-fix an actively-traded graduated token like ALT was producing ~22K snapshot rows per 24h vs. ~12K user-facing trades, ~2× the rate the chart actually needs. Sub-second resolution is unusable in the chart UI (the finest interval is 5s) so the once-per-second cadence is lossless for the only consumer of this table (the `/chart` route).

The id shape encodes the bucket: `sync-bucket-${tokenAddress}-${blockTs}`. Same-second rows hit the insert via `onConflictDoNothing()` — **first-wins**, NOT `onConflictDoUpdate`. The first Sync of a `(token, second)` bucket populates the row, and every subsequent same-second Sync short-circuits at the unique-index check before Postgres extends the heap or writes a WAL record. Two reasons this matters versus the latest-wins alternative (rejected during PR #985 review):

- **Write IOPS reduction.** `doUpdate` would still cost a Postgres round-trip + heap insert + WAL + replication + future vacuum on every single Sync (the dedup ratio only saves rows, not writes). `doNothing` cuts ALL of those proportional to the dedup ratio — ~2× write reduction on ALT, the whole point of the issue's "wastes Neon write IOPS during peak indexing" bullet.
- **Row immutability.** Once a `(token, second)` bucket row exists it is never mutated, so two queries against the same historical bucket return byte-identical results forever after the first write. The original per-event id shape provided this for free; latest-wins would silently weaken it. Charts and analytics that re-fetch historical windows can't see the row "change under them."

Cost: the bucket records the FIRST Sync's reserves rather than the last. Inside a same-second MEV sandwich the recorded reserves are pre-tail-swap rather than post-tail-swap, so a 5s candle's `close` is set by the first Sync of its last second rather than the last. At HyperSwap V2 mid-tier liquidity that's typically <0.1% drift on a sub-pixel-relevant dimension at the chart's >=5s candle resolution — and the live in-progress candle bypasses the DB entirely via the WS broadcast (which fires on every Sync regardless of the DB-side dedup, see below) so the user-facing live chart is unaffected.

The live WS broadcast still fires for **every** Sync regardless of the dedup outcome — `useChartData`'s in-progress candle aggregator merges every tick into the in-progress candle for sub-second high/low fidelity, and silencing intra-second ticks would visibly flat-line the candle whenever a user trade landed in the same block as a follow-up MEV swap.

Downstream, `apps/api/src/lib/indexer-reads.ts:fetchTokenChartSnapshots` only uses `tokenSnapshot.id` for the `(timestamp, id)` ORDER BY tiebreak, which remains deterministic with the new shape (one row per second eliminates the same-block tiebreak case anyway). **Future consumers that need per-event reserve deltas should NOT add a dependency on this table** — read `pairReserve` history (one row per pair, mutated on every Sync via `onConflictDoUpdate`) or compute deltas from `routerTrade` (per-event, append-only by `${txHash}-${logIndex}` id) instead. No backfill is needed: legacy `sync-${txHash}-${logIndex}` rows from older deploy schemas age out via the per-deploy schema rotation. `apps/indexer/test/hyperswap.test.ts` locks the first-wins same-second invariant and the broadcast-fires-per-Sync invariant.

#### Reusing `token.curveSupply` / `token.ltReserve` post-graduation

The columns are deliberately reused (rather than adding `hyperswapTokenReserve` / `hyperswapLtReserve`) so every consumer that already reads token reserves (`computeTokenPrice` for price/mcap, the change24h calculation against `tokenSnapshot`, the `/chart` ratio timeline) keeps working without graduation special-casing. The `computeCurveFilledBreakdown` path short-circuits on `graduated === true`, so the supply-percent math (which assumes the values are *virtual* AMM reserves bounded `[250M, 1B]`) doesn't run for graduated tokens — safe to overwrite with HyperSwap's *real* reserves.

## Local dev port discipline

`ponder dev` defaults to port `42069` and **silently falls back** to the next
free port (`42070`, …) if it's taken. A fallback means the indexer GraphQL
endpoint binds to whatever was on `42069` — usually a stale `ponder dev`
from a previous session whose PGlite has since closed — producing a silent
"loading forever" UX with no obvious error for any caller still hitting
that endpoint.

To prevent this we wrap `ponder dev` with `scripts/dev.mjs`, which fails fast
(non-zero exit, surfaced by turbo) when `42069` is already bound and prints
the offending PID. If you ever see the wrapper bail, kill the squatter:

```sh
lsof -ti :42069 | xargs kill -9
```

The API side has a matching guard: `checkPonderHealth` queries the
`tokens` collection rather than `{ __typename }`, so a Ponder with a
crashed DB is reported `degraded` instead of `healthy`. Keep both guards in
lockstep — bypassing one lets the failure mode return.

## Hosting

Hosted on Railway (persistent process). Dockerfile in this directory. Railway auto-deploys from `main` via GitHub integration (with "Wait for CI" enabled). Railway env vars:
- `DATABASE_URL` — Neon PostgreSQL connection string (shared with API; Ponder isolates into its own schema)
- `PONDER_RPC_URL_999` — Alchemy HyperEVM RPC
- `BONDING_START_BLOCK` — block number of contract deployment (defaults to value in `@launchpad/shared`)
