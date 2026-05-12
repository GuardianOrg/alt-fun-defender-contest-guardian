# apps/api

Hono on Cloudflare Workers, Drizzle ORM, Neon (PostgreSQL), R2 (image storage), Durable Objects (WebSocket + scheduling).

## What This App Does

REST API + WebSocket server. Serves indexed blockchain data and real-time trade/price feeds to the frontend and third-party integrators.

## Endpoints

- Token CRUD, search, list (paginated, filterable, sortable)
- Trade history and OHLCV chart data per token
- Creator profiles and portfolio holdings
- Platform stats and asset prices
- Admin analytics and content moderation
- Terminal API (`/api/v1/`) for third-party integrators
- WebSocket: `trade`, `price`, `graduation`, `newToken`, `stats`

## Aggregate routes (counter-backed, edge-cached)

`/api/v1/holders`, `/api/v1/portfolio`, `/api/v1/security`, `/api/v1/creators`, and `/api/v1/stats` all answer in O(1) (or close to it) by reading indexer-side derived tables instead of paginating the trade history (issue #397). The mapping:

| Route | Source on the indexer | Was |
|---|---|---|
| `GET /holders/:address` | `tokenBalance` index (sorted by `balance desc`) | Paginated up to 20K `routerTrades` to reconstruct balances in memory — silently undercounted on direct ERC-20 transfers. |
| `GET /portfolio/:wallet` | `tokenBalance` (live amount) ⋈ `walletPosition` (cost basis) | Paginated up to 20K `routerTrades` to recompute both fields. |
| `GET /security/:address` | `tokenBalance` row keyed `${creator}-${tokenAddress}` (primary-key hit) | Paginated up to 20K `routerTrades` to sum the creator's net position. |
| `GET /creators/:address` | `token.volumeUsd` summed across the creator's tokens (single GraphQL query) | Paginated every trade across every token the creator has ever launched. |
| `GET /stats` | `globalStats` singleton + last 24 `hourlyVolume` buckets | Paginated *every token in the catalogue* and *every Zap trade in the last 24h*. |

All five also set `Cache-Control: public, s-maxage=15..30, stale-while-revalidate=…` so the Cloudflare edge absorbs concurrent requests. The thundering-herd pattern (100 users opening the same viral token) used to fan in to up to 2,000 sequential GraphQL queries; the cache caps it at one per region per `s-maxage` window.

When you add a new high-traffic aggregate route, prefer the same pattern: persist the counter on the indexer (cheap on-write), read O(1) on the API, and edge-cache the response. The indexer-side tables that make this possible (`globalStats`, `hourlyVolume`, `walletPosition`, plus the existing per-token `volumeUsd` / `creatorFeesUsd` counters) are documented in `apps/indexer/AGENTS.md`.

## Token enrichment (graduation progress bar)

`GET /api/v1/tokens` and `GET /api/v1/tokens/:addr` return three progress fields derived in `src/lib/token-enrich.ts`:

| Field | Meaning |
|---|---|
| `curveFilled` | Headline progress toward graduation (0–100). `clamp(usdFilled, 0, 100)` where `usdFilled = realLt × rate / threshold × 100`. `null` while the indexer is degraded. Falls back to `supplyFilled` only when `k` / rate / `ltReserve` are unknown. |
| `curveFilledOrganic` | Share of `curveFilled` from organic USDC buys (indexer's `token.organicUsdcRaised`, percent of threshold). Clamped at `curveFilled`. |
| `curveFilledLeverageBoost` | Share of `curveFilled` from LT price appreciation, derived from the gap between `realLt × currentRate` and the net organic USDC raised (indexer's `organicUsdcRaised`, buys − sells, floored at 0). Clamped at 0 — a dropping LT shows as all-organic, no negative boost (product decision). |

The headline is intentionally USD-only, not `max(supplyFilled, usdFilled)`. Under the constant-product AMM with the production `VIRTUAL_LIQUIDITY_USD : graduationThresholdUsd` ratio, `supplyFilled` systematically *leads* `usdFilled` throughout most of the curve (each early dollar moves the supply counter much faster than the dollar counter), so the old `max()` formula made fresh tokens look multiples further along than the user-paid USD actually represented — e.g. a `$20` raise toward a `$300` threshold rendered as `~23%` instead of `~6.67%`. Users think in dollars; the bar tracks dollars. The contract's supply trigger (curve sells out → graduation regardless of USD) remains in place as a bear-market backstop; it just doesn't influence the progress headline.

The split requires both the indexer (`organicUsdcRaised`) and BounceTech (`ltExchangeRate`). When either is degraded we fall back to returning just `curveFilled` with the other two as `null`; the frontend renders a single solid fill rather than assuming zero for the missing bucket.

### Graduation threshold (immutable, read from RPC)

`computeCurveFilledBreakdown` takes `graduationThresholdUsd` as a required arg — it's the denominator for the USD trigger. Route handlers read it via `getGraduationThresholdUsd(c.env)` in `src/lib/protocol-config.ts`, which:

- Calls `Bonding.graduationThresholdUsd()` over RPC (HyperEVM via the `HYPEREVM_RPC_URL` env var, falling back to the public RPC).
- Caches the result per Worker isolate for 60s — the value is immutable for the life of the proxy (set once at `Bonding.initialize`, no on-chain setter), so even an aggressive cache is fine. The TTL exists so a future UUPS upgrade that bumps the value via `reinitializer` is picked up within a minute.
- Falls back to the compile-time `DEFAULT_GRADUATION_THRESHOLD_USD` (`12_000`) from `@launchpad/shared` if the RPC is unreachable — keeps the curve bar visible during outages.

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

## Image moderation (token-logo uploads)

`POST /images` runs every uploaded token logo through OpenAI's `omni-moderation-latest` endpoint before it lands in R2. The endpoint is free per OpenAI's pricing page (cross-checked against `https://help.openai.com/en/articles/4936833`) but a key is still required for auth — set via `wrangler secret put OPENAI_API_KEY`. Implementation lives in `src/lib/image-moderation.ts` (pure moderator, easy to swap providers) + `src/routes/images.ts` (route + R2 write).

Three outcomes per upload, recorded in the `moderation_logs` table:

- **Reject** → 422, no R2 write. Triggered by either (a) any image-applicable category score ≥ its `reject` threshold, or (b) OpenAI's own `flagged: true` for an image-applicable category. The full per-category threshold table lives in root `AGENTS.md` → *Image Upload & Content Moderation*.
- **Pending review** → 200 with `flaggedForReview: true`, image is still written to R2 so admins can inspect it via `GET /admin/moderation/pending`. Triggered when a score sits between `review` and `reject`.
- **Approve** → 200, plain success.

Failure mode is **fail-closed**: missing `OPENAI_API_KEY`, OpenAI 4xx/5xx, network timeout, or malformed response all surface as 503 ("moderation temporarily unavailable") and **no upload happens**. This is the failure mode the endpoint exists to prevent — never relax it without the matching docs/AGENTS update.

CSAM caveat: OpenAI does not classify `sexual/minors` from images (text-only by design). The strict `sexual` threshold acts as a coarse proxy, but this layer is **not** a NCMEC-certified hash matcher — explicitly documented in root `AGENTS.md`. Don't represent it externally as one.

### Edge rate-limit rule (Cloudflare, in front of the Worker)

A zone-level Cloudflare WAF rate-limit rule sits in front of `POST` traffic to the upload paths and is the **primary** defence layer for image-upload abuse. The in-Worker per-IP write quota (added in #509) is a fallback that only fires when this rule is absent or misconfigured, or under `wrangler dev` where zone rules don't apply.

| Field | Value |
|---|---|
| Match | `(http.request.method eq "POST") and (http.request.uri.path eq "/api/v1/images" or http.request.uri.path eq "/images")` |
| Characteristics | `ip.src` |
| Period | 60 seconds |
| Requests over the period | 5 |
| Action | Block, custom response **429** |
| Mitigation timeout | 60 seconds |

Both paths are included intentionally. `POST /images` is being removed by #509 (the dual-mount was an accidental unauthenticated route), but the rule covers both belt-and-braces so the migration window — and any future regression that re-exposes the bare mount — stays rate-limited at the edge.

#### Why a separate layer from the in-Worker limiter

Rate limiting inside the Worker still pays most of the cost the rule exists to avoid:

- The Worker has to spin up and parse headers before the in-Worker limiter runs.
- For the upload route specifically, the multipart body has to be fully ingested before `c.req.formData()` resolves and the size check fires — abusive requests still cost CPU + isolate memory + ingress before they're rejected.
- The in-Worker limiter is per-isolate, so an attacker hitting different Cloudflare colos counts separately against each one. The edge rule is globally enforced across the zone.

A native rate-limit rule rejects at the edge with zero Worker invocation, zero body upload, and zero isolate touched. That's the only layer that protects Worker CPU/memory under abuse and the only layer with cross-colo global enforcement; #509 stays in place as a fallback for the cases above.

#### Local dev caveat

`wrangler dev` does not apply zone-level WAF rules — only the in-Worker fallback (#509) runs locally. Don't be surprised that abuse repros fly through in dev; they're caught in staging/prod.

#### Verification (staging)

```sh
# Sustained POST from a single IP — expect 429 within 5 requests/min.
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST -H "X-API-Key: $KEY" \
    -F "file=@/tmp/tiny.png" \
    https://staging.alt.fun/api/v1/images
done
```

Cross-check `wrangler tail` while the loop runs — the rejected requests **must not** appear in Worker logs (that's what differentiates this layer from the in-Worker fallback; if they show up in `tail`, the edge rule is missing and #509 is doing the work alone).

#### Where the rule lives

Configured in the Cloudflare dashboard under *Security → WAF → Rate limiting rules* for the production zone. It is **not** in `wrangler.json` because WAF rate-limit rules are zone-level, not Worker-level. The canonical shape lives in the table above — re-create from it if the rule is ever deleted or drifts.

### `moderation_logs` retention

The table grows monotonically (one row per upload, no abuse vector — the abuse defences in #509 / #510 cap the *rate* of new rows, not their lifetime). `src/lib/moderation-logs-cleanup.ts` runs from the `scheduled()` handler, self-gates to **one tick per day at 03:17 UTC**, and applies the policy below. The gate is time-based rather than state-backed because the sweep is idempotent — a missed tick simply runs the next day, well within the 90 / 365 day retention windows. Issue #511.

| Decision | Retention | Rationale |
|---|---|---|
| `approved` | 90 days | Appeal window closes; pure noise after. |
| `rejected` | 365 days | Longer audit trail for appeals + abuse-pattern analysis. |
| `pending_review` | **Never** | Queue items waiting on human action — silently dropping them would lose them. |

Each daily run logs per-decision delete counts, post-cleanup row count, and `pg_total_relation_size('moderation_logs')` for capacity planning.

## Graduation keepers (two distinct cron jobs)

Two keepers run from the API Worker's `scheduled()` handler, each with its own hot wallet. They MUST be different wallets — they target different Hyperliquid block sizes and the small/big-block toggle is sticky per wallet.

| Keeper | File | Wallet env | Block size | Job |
|---|---|---|---|---|
| Finalize | `src/lib/graduation-keeper.ts` | `KEEPER_PRIVATE_KEY` | **Big** (~2.5M gas / ~60s confirm) | Drives phase 2 — calls `Bonding.finalizeGraduation` for tokens currently in `Lifecycle.Graduating`. |
| Auto-graduation | `src/lib/auto-graduation-buyer.ts` | `AUTO_GRADUATION_BUYER_PRIVATE_KEY` | **Small** (~120k gas / sub-second) | Drives phase 1 for tokens whose `realLT × exchangeRate` crossed the USD threshold via pure LT price appreciation (no user buy in the loop). Calls the permissionless `Bonding.triggerGraduation(token)` entry point — no USDC, no LT, no token positions accumulated. |

The two keepers cooperate cleanly: the auto-graduation keeper produces `Lifecycle.Graduating` tokens and the finalize keeper drains them. Wall-clock recovery from "LT pumped, threshold crossed, no buys happening" to "token graduated" is `~1 cron tick + ~60s big-block confirm` ≈ 1-2 minutes.

### Auto-graduation wallet setup

1. Generate a fresh key — never reuse `KEEPER_PRIVATE_KEY` or the deployer key.
2. Fund with HYPE for gas. No USDC needed — `triggerGraduation` is a pure on-chain trigger and doesn't move any tokens. (Legacy `Zap.buy`-trigger flow used to need ~`$120` of USDC for in-flight capital; that's no longer the case.)
3. **Leave big blocks OFF** (default). If the wallet was ever toggled on, run `DEPLOYER_PRIVATE_KEY=<this key> node packages/contracts/scripts/toggle-big-blocks.mjs off` to flip back to small blocks before deploying the secret. A wallet stuck on big blocks would queue every trigger behind a ~60s confirm, defeating the keeper's purpose.
4. `wrangler secret put AUTO_GRADUATION_BUYER_PRIVATE_KEY` for prod / preview. Set in `.dev.vars` for local development. Leaving blank disables the keeper and logs a warn on every cron tick.

### Auto-graduation mechanics

Why the keeper exists at all: graduation phase 1 normally fires inline at the end of a `Zap.buy` whose post-buy `realLT × exchangeRate ≥ Bonding.graduationThresholdUsd`. But because the bonding curve's reserve is a leveraged token, the USD value can drift past the threshold without any buys — a user funds the bonding curve close to the threshold, stops, and the LT then rallies on its own. `Bonding.canGraduate(token)` is `true` but no user is in the loop to land the triggering tx.

`Bonding.triggerGraduation(token)` is the permissionless entry point that runs `_enterGraduating` directly without requiring a buy. It re-checks all the same lifecycle gates (`creator != 0`, `lifecycle == Curve`, `canGraduate(token)`) on-chain, so a stale-by-one-block read just gets rejected with a clean `NotGraduatable` revert and the keeper retries on the next tick. This entry point also closes a structural-stuck case at the contract layer: a closing `Zap.buy` of size N can hit the BounceTech LT mint floor (`$10`) when the cap-implied `baseToConvert` falls below it; without the trigger entry point, such tokens would be permanently un-graduatable via `Zap.buy` (the Zap-side floor-bump in `Zap._executeBuy` is the matching contract-layer fix on the user path).

Detection uses `Bonding.canGraduate(token)`, the same view the contract checks post-buy when deciding whether to enter `Lifecycle.Graduating` — single source of truth across the keeper, the inline post-buy trigger, and `triggerGraduation`'s own pre-check.

The sell phase is purely defensive — it drains any token positions accumulated by the legacy `Zap.buy`-trigger flow before this switch. `triggerGraduation` doesn't custody anything, so the sell phase is a no-op once the historical inventory is gone (and can be removed in a later release).

Per-tick cap `MAX_TRIGGERS_PER_TICK = 5` bounds wall-clock per tick. A flood of newly-eligible tokens drains across multiple ticks; the `tokens.ltReserve desc` Ponder ordering on the candidate fetch means closest-to-threshold tokens are drained first.

Manual nonce management mirrors `graduation-keeper.ts` (viem's pending-nonce auto-fetch double-counts on rapid back-to-back submits). The trigger phase has no allowance / approval surface; per-token approvals for the legacy sell phase are still done once at `MAX_UINT256`.

## Durable Objects

- `WebSocketDO` — **subject-sharded** WebSocket fan-out. One DO instance per `(channel, tokenAddress)` shard, named via ``idFromName(`${channel}:${tokenAddress ?? "__all__"}`)``. Every connection on a given instance has already opted into exactly that subject, so `broadcast()` is a flat fan-out with no per-connection filter loop. Per-token events (`trade`, `price`, `graduation`) fan out to *both* the token's shard and the wildcard `__all__` shard so global subscribers (e.g. the home-page trade feed) still see them; cost is at most two stub fetches per event regardless of total connection count. The previous design was a single global DO that iterated every connection on every event — see issue #395 for the scaling rationale and `websocket/durable-object.ts` for the routing helpers.
- `WsIpLimiter` — single global DO at `idFromName("ws-ip-limiter")` that tracks per-IP WebSocket connection counts across the fleet. The `/ws` route calls `acquire` *before* the upgrade and `release` runs from the shard DO's `webSocketClose` handler. This DO became necessary once `WebSocketDO` was sharded — no individual shard sees all of an IP's connections anymore, so the cap (`MAX_CONNECTIONS_PER_IP = 10`) lives here. Operations are O(1); the bottleneck this DO replaces was a per-event O(N) loop, so the throughput trade is favourable.
- `LtTicker` — self-rescheduling alarm at 1s cadence (matched to BounceTech's ~1s write cadence on `token_snapshots_v1`). Reads the latest BounceTech LT exchange rates and broadcasts changed rates to the `price` channel per-LT. Kickstarted by a 1-minute Cron Trigger hitting `/ensure`, which is a no-op if an alarm is already scheduled. Heartbeat state is exposed at `GET /api/v1/admin/lt-ticker` for health checks.

### WebSocket connect API

`GET /ws?channel=<name>&token=<addr?>` — the upgrade path. `channel` is required; `token` is optional and, when provided, selects a per-token shard. Omitting `token` routes the connection to the channel's wildcard / global shard — that's the only valid shard for inherently-global channels like `newToken` and `stats`, where any `token` value is ignored. The frontend's `WebSocketClient` (`apps/web/src/services/websocket.ts`) multiplexes one underlying WS per subject the app cares about, so the public `subscribe(channel, handler, token?)` surface is unchanged.

The endpoint is intentionally unauthenticated — the frontend reads these feeds anonymously, so requiring an API key on the upgrade would just gate the frontend behind a leaked secret. Abuse is bounded by the `WsIpLimiter` per-IP cap (acquired before the upgrade) plus subject sharding (one connection sees one shard's events, so a single connection can't amplify cross-channel fan-out). See issue #401 for the threat model.

## Functional Spec

Full endpoint list, WebSocket events, data indexing: `docs/backend-scope.md`
