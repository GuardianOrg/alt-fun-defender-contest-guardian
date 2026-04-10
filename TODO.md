# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

## Critical — Trading & Core Flows

### Sell trade not wired in frontend
`TradePanel.tsx` → `doTrade` always calls `executeBuy`. The sell path (`executeSell` in `useTradeRouter`) is never invoked. Users cannot sell tokens from the UI.

### Slippage not applied on-chain
`useTradeRouter.ts` passes `minTokensOut = 0` / `minUsdcOut = 0` to contract calls. The slippage setting in `TradePanel` is cosmetic only — trades have unbounded slippage risk.

### `$10` minimum not enforced
BounceTech LT `mint`/`redeem` reverts below `$10` USDC (`0x05eb05ac`). The frontend does not validate this minimum on buy/sell inputs. Users will get opaque reverts.

### Async redeem (large sells) not implemented
`RedemptionRouter.sol` only calls `redeem()` — no `prepareRedeem()` / `claimRedeem()` path for large sells that exceed `baseAssetBalance()`. Spec requires a two-step flow with a ~15s delay and `sellClaimable` WebSocket notification.

---

## Contracts

### Event naming mismatch with docs
`docs/contracts-scope.md` lists `Buy`, `Sell`, `Graduated`. Code emits `Trade` (with `isBuy` flag) and `TokenGraduated`. Docs, indexer, and frontend must all align on the actual event names.

### `SellCompleted` / `SellPending` events absent
`docs/backend-scope.md` references these events on `RedemptionRouter`, but they do not exist in the Solidity code. Needed for the async redeem tracking flow.

### HyperSwap router address mismatch
`Deploy.s.sol` uses `0xda0f518d521e0dE83fAdC8500C2D21b6a6C39bF9` for HyperSwap Router. `packages/shared` and root `AGENTS.md` use `0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A`. Reconcile which is canonical for mainnet.

### Empty test: `test_postGraduation_buyReverts`
`Bonding.t.sol` has this test with no body/assertions. Needs implementation to verify curve trades revert after graduation.

### No `RedemptionRouter` tests
The user-facing entry point has zero dedicated tests. Needs coverage for: USDC→LT→curve buy, curve sell→LT→USDC redeem, post-grad HyperSwap routing, referral event emission, slippage, edge cases.

### No `LPLock` tests
Only indirectly touched via Bonding setup. Needs isolated tests for `recordLock`, unauthorized access, UUPS upgrade.

### No UUPS upgrade tests
`Bonding`, `RedemptionRouter`, and `LPLock` are all UUPS upgradeable but have no upgrade tests. Need to verify storage layout compatibility and upgrade authorization.

### Graduation not integration-tested
`_graduate()` calls HyperSwap `addLiquidity` and `LPLock.recordLock`. No mock HyperSwap in tests — graduation path is untested end-to-end. `test_postGraduation_buyReverts` is empty.

---

## Frontend — Missing Features

### WebSocket client not implemented
No `WSS /ws` client exists in `apps/web`. All real-time data uses polling intervals and mock generators. Need to implement WebSocket client with subscriptions for: `trade`, `price`, `graduation`, `newToken`, `stats`, `sellClaimable`.

### Referral `?ref=` not implemented
Spec requires reading `?ref=` from the URL, storing in session, and passing to `buy()` as `referrer`. Currently `referrer` is always `0x0000…0000`.

### Mobile responsive layouts missing
No `@media` queries anywhere in `apps/web/src`. Spec requires single-column layouts for mobile: stacked chart → trade panel (bottom sheet) → tabs on token detail, full-width profile drawer.

### 5x volatility warning banner missing
Spec requires a yellow warning banner on 5x leverage tokens: "significantly more volatility decay, recommended for short-term." No component exists for this.

### Chart data is synthetic
`Chart.tsx` generates candles via `generateCandles()` / `generateOverlay()` (random walks). Not connected to `GET /tokens/:address/chart` API endpoint.

### Holders tab returns mock data
`tradeService.getHolders()` always returns `MOCK_HOLDERS`. Not connected to any API or on-chain data source.

### Search uses client-side filtering
`SearchModal.tsx` filters the already-loaded token list in memory. `searchTokens()` from `api.ts` exists but is unused. Should use `GET /tokens/search` for server-side full-text search.

### My Positions panel uses fake data
`RightPanel.tsx` renders a hardcoded array of positions (HOUSE, WAVEBEAR, DOOMER with `+$235` P&L). Needs to use `GET /portfolio/:wallet` or on-chain balance reads.

### Comments POST not wired to API
`BottomTabs.tsx` appends comments to local state only. Does not call `POST /api/v1/comments/:address`. New comments disappear on refresh.

### Token form description and socials not connected
`TokenForm.tsx` renders description textarea and social link inputs, but they are not wired to parent state via `onChange`. `CreateView` always passes `description: ""` and `urls: ["","","",""]`.

### No redirect after token creation
After successful `launch()` + `POST /tokens`, the user stays on `/create`. Should navigate to `/token/:address`.

### Curve strip not hidden for graduated tokens
`TokenDetailView.tsx` always renders the curve progress strip. Spec says it should be hidden when `status === "graduated"`.

### Social links in hero are non-functional
`HeroSection.tsx` renders `["𝕏", "TG"]` as static text labels, not clickable links to the token's social URLs.

### Asset ticker tape 24h change always 0
`assetService.getAssets()` forces `change24h: 0` for all assets. Needs real 24h price change data from Hyperliquid.

### Sparklines use random data
`SearchModal.tsx` sparklines render `Math.random()` values per render. Should use recent price history for each token.

### Max button hardcodes amount
`TradePanel.tsx` Max button sets `"4210"` instead of the user's actual USDC balance.

### `claimEarnings` is a stub
`creatorService.claimEarnings()` returns `"0x"`. Needs to call `Bonding.claimCreatorFees()` on-chain.

### Portfolio not using API endpoint
`creatorService.getBalances()` manually iterates tokens and calls `balanceOf` on each (first 100 only). Should use `GET /portfolio/:wallet` when available.

### Creator stats not using API endpoint
Creator rewards tab builds stats manually from token list + on-chain reads instead of `GET /creator/:wallet`.

### Platform stats not using API endpoint
`usePlatformStats` uses `assetService.getPlatformStats()` (Ponder-based, partial data). Should use `GET /stats` when available.

### Missing static assets
`/avatar.png` (used in `BottomTabs.tsx`, `EarningsPanel.tsx`) and `/tokens/house.png` (used in mock data) do not exist in `apps/web/public`. Will 404 at runtime.

### Trade estimate uses mock price
`TradePanel.tsx` uses `MOCK_TOKEN_PRICE` for estimates instead of calling `tradeRouterService` quote functions.

---

## Backend API — Missing Endpoints

### `GET /portfolio/:wallet`
Token holdings with current USD values for a wallet. Spec in `docs/backend-scope.md`.

### `GET /stats`
Platform-wide stats: `tokensLive`, `tokensGraduating`, `tokensGraduated`, `volume24h`.

### `GET /assets`
Underlying asset prices + LT exchange rates for all supported pairs.

### `GET /referral/:wallet`
Referral stats: referred wallets, referred volume. Tracking only in v1.

### `GET /tokens/:address/trades`
Paginated trade history (curve + post-grad). Current `/api/v1/trades` routes return empty arrays.

### `GET /tokens/:address/chart`
OHLCV candlestick data with intervals (1s, 1m, 5m, 15m, 1h, 4h). Current `/api/v1/trades/ohlcv/:address` returns `[]`.

### `GET /tokens/:address/holders`
Top holders by balance. Depends on Transfer indexing or trade-derived holder computation.

### `GET /tokens/:address/security`
Trading terminal data: `lpLocked`, `creatorHoldingPct`, `contractVerified`.

### Admin analytics endpoints
All four missing: `GET /admin/analytics/dau` (unique wallets/day), `GET /admin/analytics/volume` (curve + pool volume/day), `GET /admin/analytics/graduations` (launches, graduations, rate, avg time), `GET /admin/analytics/revenue` (fee breakdown/day).

---

## Backend API — Incomplete Implementation

### `POST /tokens` missing wallet signature auth
Token creation accepts any request — no wallet signature verification. Spec requires auth matching the on-chain creator.

### `GET /tokens` missing filters
Only supports `limit`/`offset` with `isHidden = false`, `orderBy(desc(createdAt))`. Missing spec filters: `sort`, `direction`, `underlying`, `status`, `leverage`, `creator`.

### `GET /tokens/:address` missing computed fields
Returns raw DB row only. Missing: current price, market cap, volume, leverage decomposition, LT pair info, holder count.

### Comments endpoint at wrong path
Mounted at `/api/v1/comments/:address`. Spec says `/tokens/:address/comments`. Frontend calls the current path but should align with spec.

### `GET /creator/:wallet` incomplete
Returns `user_profiles` row only. Missing: all tokens launched, aggregate stats (volume, fees earned, fees claimable).

### Trades routes fully stubbed
Both `GET /api/v1/trades` and `GET /api/v1/trades/ohlcv/:address` return empty arrays with no implementation.

### Image upload missing content moderation
`POST /api/v1/images` handles upload + R2 storage but has no content moderation pipeline. Illegal content (CSAM, extreme violence) must be rejected before storage.

Options to evaluate:
- Cloudflare Images content moderation (if available on Workers)
- Third-party API (e.g. AWS Rekognition, Google Cloud Vision, Sightengine)
- Self-hosted model via Cloudflare Workers AI

### Image upload missing wallet signature auth
`POST /api/v1/images` has no authentication. Spec requires wallet signature.

### Terminal API not implemented
Spec requires all endpoints mirrored under `/api/v1/` with `X-API-Key` auth for third-party integrators. `api_keys` table exists in schema but no middleware reads or validates `X-API-Key`.

### WebSocket only handles ping/pong
`WebSocketDO` in `index.ts` responds to `ping` only. No subscription routing, no event channels (`trade`, `price`, `graduation`, `newToken`, `stats`, `sellClaimable`), no broadcast from trade events. No `/ws` route wiring in Hono for WebSocket upgrades.

### Rate limiting missing
No rate limiting on any endpoint. Spec requires comments to be rate-limited to 1 per 30s per wallet per token.

### No input validation middleware
Ad-hoc checks only. Need structured validation (e.g. zod schemas) for request bodies across all endpoints.

### `c.req.json()` not wrapped in try/catch
Malformed JSON payloads will throw unhandled errors instead of returning 400.

### `console.error` used instead of structured logging
Workspace rules prohibit `console.log` in production. `app.onError` uses `console.error`.

### No DB migration files
`drizzle.config.ts` points to `./src/db/migrations` but no migration SQL files exist.

### Database schema gaps
- `tokens` table missing: `underlying`, `status` (curve vs graduated), graduation time, pool address
- No rate-limit tracking columns for comments
- No tables for: referrals (analytics), per-token creator stats, DAU, OHLCV candles, trade history (if needed beyond indexer)

---

## Indexer — Missing

### `RedemptionRouter` event handlers incomplete
`RedemptionRouter` is registered in `ponder.config.ts` and `Referred` is indexed, but `Buy`, `Sell`, and `TokenCreated` events still need handlers. The USDC-denominated trade data that the frontend needs is missing.

### HyperSwap Swap/Sync events not indexed
No HyperSwap V2 Pair contract registered. Post-graduation DEX trades and reserve updates are invisible to the indexer. Need dynamic pair registration (factory pattern or known list after graduation).

### External polling not implemented
None of the external data sources are polled:
- BounceTech LT `exchangeRate()` (needed every block for price computation)
- Bounce Indexing API `GET /trade/:txHash` (for `prepareRedeem` completion tracking)
- Bounce Indexing API `GET /leveraged-tokens` (LT metadata refresh)
- Hyperliquid price feeds (underlying asset spot prices)

### No volume aggregation
Only raw `trade` rows stored. No precomputed 24h volume, per-token volume rollups, or global volume metrics.

### No OHLCV candlestick computation
No candle aggregation from trade data. The API chart endpoint has nothing to serve.

### No holder count computation
No holder tracking from trade data. `Transfer` events are skipped in v1 (per spec), but holder counts should be derivable from buy/sell events.

### No platform stats aggregation
No precomputed counts for `tokensLive`, `tokensGraduating`, `tokensGraduated`, `volume24h`.

### `CreatorFeesClaimed` / `ProtocolFeesClaimed` events not handled
These Bonding events are declared but not indexed. Needed for creator/admin analytics.

### Handler types use `any`
`src/bonding.ts` has file-wide `eslint-disable` for `no-explicit-any`. All handlers use `event: any` / `context: any` instead of Ponder-generated types.

### `AGENTS.md` claims broader scope than implementation
`apps/indexer/AGENTS.md` describes indexing for `RedemptionRouter`, HyperSwap, and external polling, but the implementation only covers four Bonding events.

---

## Shared Package & Config

### BounceTech `$10` minimum not in shared constants
The minimum USDC amount for LT mint/redeem should be a named constant in `packages/shared` for use in frontend validation.

### Apps duplicate TypeScript config
`apps/web`, `apps/api`, and `packages/shared` all duplicate compiler options instead of extending `@launchpad/config/typescript/*` presets. Drift risk.

### Web app doesn't use shared ESLint base
`apps/web/eslint.config.js` inlines its own config stack rather than extending `@launchpad/config/eslint/base`. Not a bug, but divergence risk.

### `FPair` ABI not exported
May be needed for post-graduation pool interactions (reading reserves, etc.). Currently only six contracts exported via `export-abi.mjs`.

---

## Tech Debt

### Extensive mock data throughout frontend
`services/mock/` (tokens, assets, trades) used as fallbacks in production code paths. Mock data leaks into the UI when APIs are down. Should be dev-only or removed once real data flows are complete.

### `ErrorBoundary` has no error logging
`componentDidCatch` is not implemented. Errors caught by the boundary are silently swallowed with a generic fallback UI.

### Privy `appId` has no runtime guard
If `VITE_PRIVY_APP_ID` is unset, the app will fail at runtime with an opaque error. Should fail fast with a clear message.

### `creatorService.getBalances` only checks first 100 tokens
Portfolio computation iterates the first page of `fetchTokens` (limit 100) and calls `balanceOf` on each. Incomplete for users holding >100 tokens, and expensive (N RPC calls).

### Password gate hardcoded in source
`PasswordGate.tsx` checks against `"launchpad2026"`. Fine for a dev gate, but the password is visible in the client bundle. Consider moving to an env variable or removing before launch.

### Image URL resolution may break cross-origin
API returns image paths like `/images/tokens/...`. If the frontend and API are on different origins (Cloudflare Pages vs Workers), `<img src>` needs `VITE_API_URL` prefix.

### `IUniswapV2Router02.factory()` marked `pure`
Should be `view` to match the real UniV2 router. Works in practice via `staticcall` but is technically incorrect.
