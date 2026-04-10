# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

## Critical — Trading & Core Flows

### Async redeem (large sells) not implemented

`RedemptionRouter.sol` only calls `redeem()` — no `prepareRedeem()` / `claimRedeem()` path for large sells that exceed `baseAssetBalance()`. Spec requires a two-step flow with a ~15s delay and `sellClaimable` WebSocket notification. For this, read through the bounce docs in detail https://docs.bounce.tech/ in particular this page: https://docs.bounce.tech/technical/integration-guide And also look at the repo https://github.com/bounce-tech/bounce-data in particular the readme, we have some stuff that might make this integration easier. Also look at ./bounce-webapp. It's not part of this core repo and I will delete it soon, it's the webapp of bounce, and they have some nice code examples in there for querying certian data, minting, redeeming, prepare redeeming (which can be a bit tricky) and some other things. Worth a look at.

---

## Contracts

### Event naming mismatch with docs

`docs/contracts-scope.md` lists `Buy`, `Sell`, `Graduated`. Code emits `Trade` (with `isBuy` flag) and `TokenGraduated`. Docs should be updated to match code.

### `SellCompleted` / `SellPending` events absent

`docs/backend-scope.md` references these events on `RedemptionRouter`, but they do not exist in the Solidity code. Needed for the async redeem tracking flow.

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

## Frontend — Remaining

### WebSocket client not implemented

No `WSS /ws` client exists in `apps/web`. All real-time data uses polling intervals and mock generators. Need to implement WebSocket client with subscriptions for: `trade`, `price`, `graduation`, `newToken`, `stats`.

### Mobile responsive layouts missing

No `@media` queries anywhere in `apps/web/src`. Spec requires single-column layouts for mobile: stacked chart → trade panel (bottom sheet) → tabs on token detail, full-width profile drawer.

### Asset ticker tape 24h change always 0

`assetService.getAssets()` forces `change24h: 0` for all assets. Needs real 24h price change data from Hyperliquid.

### Sparklines use random data

`SearchModal.tsx` sparklines render `Math.random()` values per render. Should use recent price history for each token.

### `claimEarnings` is a stub

`creatorService.claimEarnings()` returns `"0x"`. Needs to call `Bonding.claimCreatorFees()` on-chain.

---

## Backend API — Remaining

### Admin analytics endpoints

All four missing: `GET /admin/analytics/dau` (unique wallets/day), `GET /admin/analytics/volume` (curve + pool volume/day), `GET /admin/analytics/graduations` (launches, graduations, rate, avg time), `GET /admin/analytics/revenue` (fee breakdown/day).

### Comments endpoint at wrong path

Mounted at `/api/v1/comments/:address`. Spec says `/tokens/:address/comments`. Frontend calls the current path but should align with spec.

### Image upload missing content moderation

`POST /api/v1/images` handles upload + R2 storage but has no content moderation pipeline. Illegal content (CSAM, extreme violence) must be rejected before storage.

Options to evaluate:

- Cloudflare Images content moderation (if available on Workers)
- Third-party API (e.g. AWS Rekognition, Google Cloud Vision, Sightengine)
- Self-hosted model via Cloudflare Workers AI

### Terminal API not implemented

Spec requires all endpoints mirrored under `/api/v1/` with `X-API-Key` auth for third-party integrators. `api_keys` table exists in schema but no middleware reads or validates `X-API-Key`.

### No DB migration files

`drizzle.config.ts` points to `./src/db/migrations` but no migration SQL files exist.

---

## Indexer — Remaining

### HyperSwap Swap/Sync events not indexed

No HyperSwap V2 Pair contract registered. Post-graduation DEX trades and reserve updates are invisible to the indexer. Need dynamic pair registration (factory pattern or known list after graduation).

### External polling not implemented

None of the external data sources are polled:

- BounceTech LT `exchangeRate()` (needed every block for price computation)
- Bounce Indexing API `GET /leveraged-tokens` (LT metadata refresh)
- Hyperliquid price feeds (underlying asset spot prices)

---

## Shared Package & Config

### Apps duplicate TypeScript config

`apps/web`, `apps/api`, and `packages/shared` all duplicate compiler options instead of extending `@launchpad/config/typescript/*` presets. Drift risk.

### Web app doesn't use shared ESLint base

`apps/web/eslint.config.js` inlines its own config stack rather than extending `@launchpad/config/eslint/base`. Not a bug, but divergence risk.

---

## Tech Debt

### Extensive mock data throughout frontend

`services/mock/` (tokens, assets, trades) used as fallbacks in production code paths. Mock data leaks into the UI when APIs are down. Should be dev-only or removed once real data flows are complete.

### `ErrorBoundary` has no error logging

`componentDidCatch` is not implemented. Errors caught by the boundary are silently swallowed with a generic fallback UI.

### Privy `appId` has no runtime guard

If `VITE_PRIVY_APP_ID` is unset, the app will fail at runtime with an opaque error. Should fail fast with a clear message.

### Password gate hardcoded in source

`PasswordGate.tsx` checks against `"launchpad2026"`. Fine for a dev gate, but the password is visible in the client bundle. Consider moving to an env variable or removing before launch.

### `IUniswapV2Router02.factory()` marked `pure`

Should be `view` to match the real UniV2 router. Works in practice via `staticcall` but is technically incorrect.
