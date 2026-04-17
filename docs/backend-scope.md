# Backend Scope

REST API + WebSocket server for the Alt Fun frontend and third-party integrators. Indexed blockchain data, user-generated content, and real-time feeds.

---

## Events to Index

| Event | Contract | Key Fields |
|---|---|---|
| `TokenLaunched` | Bonding | `token`, `creator`, `ltAddress`, `name`, `ticker`, `k`, `index` |
| `Trade` | Bonding | `token`, `trader`, `isBuy`, `ltAmount`, `tokenAmount`, `newCurveSupply`, `newLtReserve` |
| `TokenGraduated` | Bonding | `token`, `pairAddress`, `liquidity` |
| `CreatorFeesClaimed` | Bonding | `creator`, `lt`, `amount` |
| `ProtocolFeesClaimed` | Bonding | `lt`, `amount` |
| `Buy` | LaunchpadRouter | `token`, `buyer`, `usdcIn`, `tokensOut` |
| `Sell` | LaunchpadRouter | `token`, `seller`, `tokensIn`, `usdcOut` |
| `Referred` | LaunchpadRouter | `trader`, `referrer`, `token`, `usdcAmount` |
| HyperSwap `Swap` | V2 Pair | `amount0In/Out`, `amount1In/Out`, `timestamp` (only graduated pairs) |
| HyperSwap `Sync` | V2 Pair | `reserve0`, `reserve1` |
| FERC20 `Transfer` | FERC20 | `from`, `to`, `amount` — skipped in v1 (high indexing load). Holder counts derived from trade data instead. |

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
| `GET /tokens/:address/comments` | Paginated comments. |
| `POST /tokens/:address/comments` | Post comment. Auth: wallet signature. Max 500 chars. Rate limit: 1 per 30s per wallet per token. |

### Creator / Portfolio / Platform

| Endpoint | Description |
|---|---|
| `GET /creator/:wallet` | All tokens launched + aggregate stats (volume, fees earned, fees claimable). |
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
| `GET /admin/analytics/revenue` | Fee breakdown per day |
| `POST /admin/tokens/:address/hide` | Content moderation — hide from feeds |
| `POST /admin/tokens/:address/unhide` | Reverse hide |

### Image Upload

| Endpoint | Description |
|---|---|
| `POST /images` | Upload token image. Max 5MB. Accepts JPEG, PNG, GIF, WebP. Server-side content moderation (reject illegal content — CSAM, extreme violence). Adult content permitted if legal. Returns R2 URL. Auth: wallet signature. |

### Terminal API

All above endpoints mirrored under `/api/v1/` with `X-API-Key` auth for third-party integrators.

### Admin Authentication

Admin endpoints use `X-Admin-Key` header with a shared secret stored as a Cloudflare Worker secret (`ADMIN_API_KEY`). Wallet-based admin auth deferred to v2.

---

## WebSocket

Single endpoint: `WSS /ws`. Clients subscribe to channels.

| Event | Description | Subscription |
|---|---|---|
| `trade` | Every buy/sell on the bonding curve | Global or per-token |
| `price` | LT exchange rate tick (from `LtTicker` DO, ~2s cadence) | Per-LT (routing key is the LT contract address) |
| `graduation` | Token graduated | Global |
| `newToken` | Token launched | Global |
| `stats` | Platform stats update | Global (every 10-30s) |

### `trade` payload

Broadcast from the Ponder indexer's `Bonding:Trade` handler via fire-and-forget POST to `/api/v1/webhook/indexer`. Historical backfill is skipped — the broadcaster only fires when the block timestamp is within 60s of wall-clock now.

```json
{
  "id": "0x<txHash>-<logIndex>",
  "tokenAddress": "0x…",
  "trader": "0x…",
  "isBuy": true,
  "ltAmount": "<bigint as string, 1e18-scaled>",
  "tokenAmount": "<bigint as string, 1e18-scaled>",
  "curveSupply": "<post-trade curveSupply, 1e18-scaled>",
  "ltReserve": "<post-trade ltReserve, 1e18-scaled>",
  "timestamp": "<unix seconds as string>"
}
```

`curveSupply` and `ltReserve` let clients recompute the live curve ratio without a round-trip. The chart pairs these with `price` ticks to drive live updates.

### `price` payload

Produced by the `LtTicker` Durable Object, which wakes every 2 seconds via a self-rescheduling alarm, reads the latest `exchange_rate` per LT from BounceTech's `token_snapshots_v1` (LATERAL query), and broadcasts only LTs whose rate changed since the previous tick. Routing key is the LT contract address, not the bonding token address — a single LT update fans out to all tokens that share it.

```json
{
  "ltAddress": "0x…",
  "exchangeRate": "<bigint as string, 1e18-scaled>",
  "ts": "<unix seconds>"
}
```

Clients convert to a float via `Number(exchangeRate) / 1e18`. The live price formula `price = (ltReserve / curveSupply) × exchangeRate` is implemented in `computeTokenPrice` from `@launchpad/shared` and is the single source of truth on both server and client.
