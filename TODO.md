# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

## Contracts

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

### `IUniswapV2Router02.factory()` marked `pure`

Should be `view` to match the real UniV2 router. Works in practice via `staticcall` but is technically incorrect.

---

## Frontend — Remaining

### WebSocket client not implemented

No `WSS /ws` client exists in `apps/web`. All real-time data uses polling intervals and mock generators. Need to implement WebSocket client with subscriptions for: `trade`, `price`, `graduation`, `newToken`, `stats`. Note: `sellClaimable` was removed — we use atomic redeems only with buffer-aware UI.

### Mobile responsive layouts missing

No `@media` queries anywhere in `apps/web/src`. Spec requires single-column layouts for mobile: stacked chart → trade panel (bottom sheet) → tabs on token detail, full-width profile drawer.

---

## Backend API — Remaining

### Image upload missing content moderation

`POST /api/v1/images` handles upload + R2 storage but has no content moderation pipeline. Illegal content (CSAM, extreme violence) must be rejected before storage.

Options to evaluate:

- Cloudflare Images content moderation (if available on Workers)
- Third-party API (e.g. AWS Rekognition, Google Cloud Vision, Sightengine)
- Self-hosted model via Cloudflare Workers AI

### Terminal API not implemented

Spec requires all endpoints mirrored under `/api/v1/` with `X-API-Key` auth for third-party integrators. `api_keys` table exists in schema but no middleware reads or validates `X-API-Key`.

---

## Indexer — Remaining

### HyperSwap Swap/Sync events not indexed

No HyperSwap V2 Pair contract registered. Post-graduation DEX trades and reserve updates are invisible to the indexer. Need dynamic pair registration (factory pattern or known list after graduation).

### External polling not implemented

None of the external data sources are polled:

- BounceTech LT `exchangeRate()` (needed every block for price computation)
- Bounce Indexing API `GET /leveraged-tokens` (LT metadata refresh)
- Hyperliquid price feeds (underlying asset spot prices)
