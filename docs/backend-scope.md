# Backend Scope

REST API + WebSocket server for the launchpad frontend and third-party integrators. Indexed blockchain data, user-generated content, and real-time feeds.

---

## Events to Index

| Event | Contract | Key Fields |
|---|---|---|
| `TokenLaunched` | Bonding | `token`, `creator`, `ltAddress`, `name`, `ticker`, `k`, `index` |
| `Trade` | Bonding | `token`, `trader`, `isBuy`, `ltAmount`, `tokenAmount`, `newCurveSupply`, `newLtReserve` |
| `TokenGraduated` | Bonding | `token`, `pairAddress`, `liquidity` |
| `CreatorFeesClaimed` | Bonding | `creator`, `lt`, `amount` |
| `ProtocolFeesClaimed` | Bonding | `lt`, `amount` |
| `Buy` | RedemptionRouter | `token`, `buyer`, `usdcIn`, `tokensOut` |
| `Sell` | RedemptionRouter | `token`, `seller`, `tokensIn`, `usdcOut` |
| `Referred` | RedemptionRouter | `trader`, `referrer`, `token`, `usdcAmount` |
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
| `GET /portfolio/:wallet` | Token holdings with current USD values. Only launchpad tokens. |
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
| `trade` | Every buy/sell (curve or pool) | Global or per-token. `minimumSize` filter. |
| `price` | Price change after trade or LT rate update | Per-token |
| `graduation` | Token graduated | Global |
| `newToken` | Token launched | Global |
| `stats` | Platform stats update | Global (every 10-30s) |
