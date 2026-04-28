# apps/api

Hono on Cloudflare Workers, Drizzle ORM, Neon (PostgreSQL), R2 (image storage), Durable Objects (WebSocket + scheduling).

## What This App Does

REST API + WebSocket server. Serves indexed blockchain data, comments, and real-time trade/price feeds to the frontend and third-party integrators.

## Endpoints

- Token CRUD, search, list (paginated, filterable, sortable)
- Trade history and OHLCV chart data per token
- Creator profiles and portfolio holdings
- Platform stats and asset prices
- Comments per token
- Admin analytics and content moderation
- Terminal API (`/api/v1/`) for third-party integrators
- WebSocket: `trade`, `price`, `graduation`, `newToken`, `stats`

## Token enrichment (graduation progress bar)

`GET /api/v1/tokens` and `GET /api/v1/tokens/:addr` return three progress fields derived in `src/lib/token-enrich.ts`:

| Field | Meaning |
|---|---|
| `curveFilled` | Headline progress toward graduation (0–100). `max(supplyFilled, usdFilled)` — whichever trigger fires first. `null` while the indexer is degraded. |
| `curveFilledOrganic` | Share of `curveFilled` from organic USDC buys (indexer's `token.organicUsdcRaised`). Clamped at `curveFilled`. |
| `curveFilledLeverageBoost` | Share of `curveFilled` from LT price appreciation, derived from the gap between `realLt × currentRate` and the lifetime organic USDC. Clamped at 0 — a dropping LT shows as all-organic, no negative boost (product decision). |

When the supply trigger is leading (`supplyFilled > usdFilled` — typical under tight `VIRTUAL_LIQUIDITY_USD`), `computeCurveFilledBreakdown` keeps the LT-appreciation-vs-organic-USD ratio honest by computing the split inside `usdFilled` and then stretching both buckets by `total / usdFilled`. The supply-side overshoot is attributed to organic buy pressure, never to leverage. The previous `leverageBoost = total − organic` formula misattributed that gap as leverage and rendered phantom boost on flat-LT seed buys.

The split requires both the indexer (`organicUsdcRaised`) and BounceTech (`ltExchangeRate`). When either is degraded we fall back to returning just `curveFilled` with the other two as `null`; the frontend renders a single solid fill rather than assuming zero for the missing bucket.

### Graduation threshold (mutable, read from indexer)

`computeCurveFilledBreakdown` takes `graduationThresholdUsd` as a required arg — it's the denominator for the USD trigger. Route handlers read it via `getGraduationThresholdUsd(env.PONDER_URL)` in `src/lib/protocol-config.ts`, which:

- Queries the indexer's `protocolConfig(id: "global")` row over GraphQL.
- Caches the result per Worker isolate for 60s — threshold changes are extremely rare and stale-by-60s is fine for a marketing %.
- Falls back to the compile-time `DEFAULT_GRADUATION_THRESHOLD_USD` (`12_000`) from `@launchpad/shared` if the indexer is unreachable or the row is missing — keeps the curve bar visible during indexer outages and on cold isolates before the bootstrap fires.

**Don't hardcode `12_000` in enrichment logic.** Threading the threshold through `computeCurveFilledBreakdown` keeps the function pure / unit-testable; the I/O lives in the route handler.

### Virtual vs real reserves (important)

The indexer persists `curveSupply` and `ltReserve` verbatim from `Bonding.Trade.newCurveSupply` / `newLtReserve`, which are the **virtual AMM reserves** (`IPair.getReserves()`). These are the right values for chart pricing (`ratio = reserve1 / reserve0` *is* the on-curve price) but are **not** the real token/LT balances in the pair:

- `reserve0` is initialised to `TOTAL_SUPPLY` (1B × 1e18) and floors at `LP_RESERVE_RAW` (250M × 1e18) at full sellout — range [250M, 1B], not [0, 750M].
- `reserve1` is initialised to `virtualLtAtLaunch = $4K / rate_at_launch` and grows with buys — not 0 at launch.

`token-enrich.ts` converts virtual → real before computing graduation progress:

- `realRemaining = max(0, reserve0 − LP_RESERVE_RAW)` — matches `IPair.tokenBalance()`.
- `virtualLtAtLaunch = k / TOTAL_SUPPLY` (from `Pair.mint` where `k = totalSupply × virtualLtReserve`).
- `realLt = max(0, reserve1 − virtualLtAtLaunch)` — matches `IPair.assetBalance()` and therefore `Bonding.canGraduate`'s USD trigger.

This means every API query that feeds graduation-progress math **must include `k`** — it's required for the virtual-LT subtraction. Without it the USD fill silently overcounts by the initial $4K virtual liquidity, so the enricher degrades cleanly to supply-only progress when `k` is missing.

### Post-graduation: the same columns mirror HyperSwap reserves

Once a token graduates, `Bonding.Trade` stops firing and the curve pair drains to zero. The indexer's `HyperSwapPair:Sync` handler then takes over: every Sync rewrites `token.curveSupply` / `token.ltReserve` with the live HyperSwap V2 pair reserves (mapped via the cached `hyperswapPairIndex.tokenIsToken0`) and appends a `tokenSnapshot` row. This keeps the same `computeTokenPrice(curveSupply, ltReserve, rate)` formula working post-graduation without graduation special-casing — price/mcap/change24h all keep moving with DEX activity.

The "virtual vs real" conversion above is curve-only. `computeCurveFilledBreakdown` short-circuits on `graduated === true` (returns `total: 100`, organic/boost null), so the [250M, 1B] virtual range no longer applies — safe to overwrite the columns with HyperSwap's *real* reserves once the token has graduated.

### Chart route post-graduation

`GET /api/v1/chart/:address` builds the ratio timeline from the `tokenSnapshot` table — written by both `Bonding:Trade` (curve) and `HyperSwapPair:Sync` (post-grad). One paginated query covers both phases; no special-casing needed in the route handler. The `currentRatio` returned alongside the candles is the latest snapshot's `ltReserve / curveSupply`, which the frontend folds with the live LT rate from the `price` WS channel to keep the in-progress candle moving. See `apps/indexer/AGENTS.md → Post-graduation reserve mirror` for the source-of-truth side.

## Durable Objects

- `WebSocketDO` — fans out WS messages to subscribed clients. Supports global and per-subject routing (keyed by token or LT address).
- `LtTicker` — self-rescheduling alarm at 2s cadence. Reads the latest BounceTech LT exchange rates from `token_snapshots_v1` and broadcasts changed rates to the `price` channel per-LT. Kickstarted by a 1-minute Cron Trigger hitting `/ensure`, which is a no-op if an alarm is already scheduled. Heartbeat state is exposed at `GET /api/v1/admin/lt-ticker` for health checks.

## Functional Spec

Full endpoint list, WebSocket events, data indexing: `docs/backend-scope.md`
