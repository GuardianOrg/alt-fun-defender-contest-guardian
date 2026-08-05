# Backend Scope

REST API + WebSocket server for the Alt Fun frontend and third-party integrators. Indexed blockchain data, user-generated content, and real-time feeds.

---

## Events to Index

| Event | Contract | Key Fields |
|---|---|---|
| `TokenLaunched` | Bonding | `token`, `creator`, `ltAddress`, `name`, `ticker`, `k`, `index` |
| `Trade` | Bonding | `token`, `trader`, `isBuy`, `ltAmount`, `tokenAmount`, `newCurveSupply`, `newLtReserve` |
| `TokenGraduated` | Bonding | `token`, `pairAddress`, `liquidity` |
| `FeeAccrued` | FeeVault | `token`, `creator`, `creatorAmount`, `protocolAmount`, `isBuy` — appends to `feeAccrual` for the daily revenue dashboard AND bumps running `creatorFeesUsd` / `protocolFeesUsd` counters on the `token` row for per-token earnings |
| `CreatorFeesClaimed` | FeeVault | `creator`, `amount` (USDC) |
| `ProtocolFeesClaimed` | FeeVault | `feeTo`, `amount` (USDC) |
| `Buy` | Zap | `token`, `buyer`, `usdcIn`, `tokensOut` |
| `Sell` | Zap | `token`, `seller`, `tokensIn`, `usdcOut` |
| `Referred` | Zap | `trader`, `referrer`, `token`, `usdcAmount` |
| HyperSwap `Swap` | V2 Pair | `amount0In/Out`, `amount1In/Out`, `timestamp` (only graduated pairs) |
| HyperSwap `Sync` | V2 Pair | `reserve0`, `reserve1` |
| Token `Transfer` | Token | `from`, `to`, `amount` — skipped in v1 (high indexing load). Holder counts derived from trade data instead. |

### External Polling

| Source | What | Frequency |
|---|---|---|
| BounceTech LT `exchangeRate()` | USD per LT for each supported LT | Every block |
| Bounce Indexing API `GET /leveraged-tokens` | All LT addresses, exchange rates, metadata | On startup + periodic refresh |
| Hyperliquid `POST /info {"type":"allMids"}` | Underlying asset spot prices (HYPE, ETH, BTC, SOL, etc.) | Every few seconds |
| Hyperliquid WS `allMids` subscription | Real-time price stream | Persistent connection |

---

## REST API

### Tokens

| Endpoint | Description |
|---|---|
| `POST /tokens` | Create off-chain metadata after on-chain `launch()`. Auth: wallet signature matching creator. |
| `GET /tokens` | Paginated, filterable, sortable list. Filters: `sort`, `direction`, `underlying`, `status`, `leverage`, `creator`. |
| `GET /tokens/:address` | Full detail: price, MC, volume, leverage decomposition, LT pair info, holder count. |
| `POST /tokens/batch` | Fetch multiple by address. Max 100. |
| `GET /tokens/search` | Full-text search on name, ticker, address. <200ms response. |
| `GET /tokens/:address/trades` | Paginated trade history (curve + post-grad). `minimumSize` filter. |
| `GET /tokens/:address/chart` | OHLCV candlestick data. Intervals: 1s, 1m, 5m, 15m, 1h, 4h. Continuous across graduation. |
| `GET /tokens/:address/holders` | Top holders by balance. Optional (depends on Transfer indexing). |
| `GET /tokens/:address/security` | For trading terminals: `lpLocked`, `creatorHoldingPct`, `contractVerified`. |

### Creator / Portfolio / Platform

| Endpoint | Description |
|---|---|
| `GET /creator/:wallet` | All tokens launched + aggregate stats (volume, fees earned, fees claimable). Claimable is a single pooled USDC figure sourced from `FeeVault.creatorBalance(wallet)`. Per-token `creatorFeesUsd` rides along on the existing `/tokens` response — sourced from a running counter on the indexer's `token` row, bumped on every `FeeVault:FeeAccrued`. |
| `GET /portfolio/:wallet` | Token holdings with current USD values. Only Alt Fun tokens. |
| `GET /stats` | Platform-wide: `tokensLive`, `tokensGraduating`, `tokensGraduated`, `volume24h`. |
| `GET /assets` | Underlying asset prices + LT exchange rates for all supported pairs. |
| `GET /referral/:wallet` | Referral stats: referred wallets, referred volume. Tracking only. |

### Admin

| Endpoint | Description |
|---|---|
| `GET /admin/analytics/dau` | Unique wallets per day |
| `GET /admin/analytics/volume` | Curve + pool volume per day |
| `GET /admin/analytics/graduations` | Launches, graduations, rate, avg time |
| `GET /admin/analytics/revenue` | USDC fee breakdown per day (accrual-based, sourced from `FeeVault.FeeAccrued`) |
| `POST /admin/tokens/:address/hide` | Content moderation — hide from feeds |
| `POST /admin/tokens/:address/unhide` | Reverse hide |

### Image Upload

| Endpoint | Description |
|---|---|
| `POST /images` | Upload token image. Max 5MB. Accepts JPEG, PNG, GIF, WebP. Server-side content moderation via OpenAI `omni-moderation-latest` (free tier; per-category thresholds cover violence, gore, sexual content, self-harm). Adult content permitted if legal. Borderline images go to a manual review queue. Failure mode is fail-closed (503, no upload) when the moderation API is unavailable. Capped at 5 req/min/IP by a Cloudflare WAF rate-limit rule at the edge — see `apps/api/AGENTS.md` → *Edge rate-limit rule*. **Not a CSAM-specific detector** — see `AGENTS.md` → *Image Upload & Content Moderation* for the caveat. Returns R2 URL. Auth: wallet signature. |

### Response caching

Read endpoints that are safe to share across callers declare a freshness window and are served from Cloudflare's edge for that window, so repeat traffic never reaches the database. Endpoints that vary per caller (the wallet-aware token detail lens) declare `no-store` and are never stored anywhere.

A declared window is emitted for three tiers at once: the browser (always revalidate), the Worker's own cache, and the Cloudflare zone. The zone reads a Cloudflare-specific directive and ignores the standard one, so all three are generated from a single TTL in `apps/api/src/utils/cache-control.ts` — a route cannot advertise a window that one tier silently ignores.

### Terminal API

All above endpoints mirrored under `/api/v1/` with `X-API-Key` auth for third-party integrators.

### Admin Authentication

Admin endpoints use `X-Admin-Key` header with a shared secret stored as a Cloudflare Worker secret (`ADMIN_API_KEY`). Wallet-based admin auth deferred to v2.

---

## WebSocket

Single endpoint: `WSS /ws?channel=<name>&token=<addr?>`. Public, anonymous — feeds are read by the unauthenticated frontend, so the upgrade carries no auth (see issue #401 for the threat-model write-up). Clients open one connection per `(channel, token?)` subject they care about; each connection lands on its own subject-sharded `WebSocketDO` instance — see `apps/api/AGENTS.md` and issue #395 for the sharding rationale. The frontend `WebSocketClient` (`apps/web/src/services/websocket.ts`) multiplexes these connections behind the same `subscribe(channel, handler, token?)` API, so callers don't need to manage them directly.

| Event | Description | Subscription |
|---|---|---|
| `trade` | Every buy/sell on the bonding curve | Global (`token` omitted → wildcard shard) or per-token |
| `price` | LT exchange rate tick (from `LtTicker` DO, ~1s cadence) | Per-LT (`token` is the LT contract address) |
| `graduation` | Token graduated | Per-token (or wildcard) |
| `newToken` | Token launched | Global (`token` ignored) |
| `stats` | Platform stats update | Global (every 10-30s; `token` ignored) |

For per-token channels, the API broadcasts every event to **two** shards: the token's own shard and the channel's wildcard shard. Per-IP connection limits (10 concurrent) are enforced by a separate `WsIpLimiter` DO before the upgrade is accepted, since no individual subject shard sees all of an IP's connections.

### `trade` payload

Broadcast from the Ponder indexer via fire-and-forget POST to `/api/v1/webhook/indexer`. Historical backfill is skipped — broadcasters only fire when the block timestamp is within 60s of wall-clock now. Two disjoint variants share the channel; consumers route by which optional group is populated.

**Trade-list variant** (from `Zap:Buy` and `Zap:Sell`). `id` matches the REST `routerTrade.id` so live broadcasts dedupe against the `/api/v1/trades` poll fallback. `usdcAmount` is the gross USDC the user paid/received — the canonical user-facing value:

```json
{
  "id": "0x<txHash>-<zapLogIndex>",
  "tokenAddress": "0x…",
  "trader": "0x…",
  "isBuy": true,
  "usdcAmount": "<bigint as string, 1e6-scaled>",
  "tokenAmount": "<bigint as string, 1e18-scaled>",
  "timestamp": "<unix seconds as string>"
}
```

**Chart-state variant** (from `Bonding:Trade` and `HyperSwapPair:Sync`). Carries only the post-trade virtual AMM reserves so clients can recompute the live curve/DEX ratio without a round-trip. The chart pairs these with `price` ticks to drive live updates:

```json
{
  "id": "<id>",
  "tokenAddress": "0x…",
  "curveSupply": "<post-trade curveSupply, 1e18-scaled>",
  "ltReserve": "<post-trade ltReserve, 1e18-scaled>",
  "timestamp": "<unix seconds as string>"
}
```

`id` format depends on the producer: `Bonding:Trade` emits `${txHash}-${logIndex}`, while `HyperSwapPair:Sync` prefixes its variant with `sync-` (i.e. `sync-${txHash}-${logIndex}`) to keep the two streams' IDs disjoint in the shared `tokenSnapshot` keyspace. Consumers must treat the field as an opaque string and not parse it as `${tx}-${idx}`.

The split exists because `Bonding:Trade` records the LT actually consumed by the curve (which can be strictly less than what the user paid for — e.g. a graduation-triggering buy whose final increment hits the supply cap), while `Zap:Buy` records the gross USDC input. Sourcing the trade list from the Zap variant keeps the live feed consistent with the REST `/api/v1/trades` route (which reads from `routerTrade`).

### `price` payload

Produced by the `LtTicker` Durable Object, which wakes every 1 second via a self-rescheduling alarm (matched to BounceTech's ~1s write cadence), reads the latest `exchange_rate` per LT from BounceTech's `token_snapshots_v1` (LATERAL query), and broadcasts only LTs whose rate changed since the previous tick. Routing key is the LT contract address, not the bonding token address — a single LT update fans out to all tokens that share it.

```json
{
  "ltAddress": "0x…",
  "exchangeRate": "<bigint as string, 1e18-scaled>",
  "ts": "<unix seconds>"
}
```

Clients convert to a float via `Number(exchangeRate) / 1e18`. The live price formula `price = (ltReserve / curveSupply) × exchangeRate` is implemented in `computeTokenPrice` from `@launchpad/shared` and is the single source of truth on both server and client.
