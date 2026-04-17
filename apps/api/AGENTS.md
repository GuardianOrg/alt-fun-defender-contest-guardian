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

## Durable Objects

- `WebSocketDO` — fans out WS messages to subscribed clients. Supports global and per-subject routing (keyed by token or LT address).
- `LtTicker` — self-rescheduling alarm at 2s cadence. Reads the latest BounceTech LT exchange rates from `token_snapshots_v1` and broadcasts changed rates to the `price` channel per-LT. Kickstarted by a 1-minute Cron Trigger hitting `/ensure`, which is a no-op if an alarm is already scheduled. Heartbeat state is exposed at `GET /api/v1/admin/lt-ticker` for health checks.

## Functional Spec

Full endpoint list, WebSocket events, data indexing: `docs/backend-scope.md`
