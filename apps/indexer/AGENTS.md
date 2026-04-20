# apps/indexer

Ponder EVM indexer. Indexes on-chain events from Alt Fun contracts and HyperSwap V2 pools.

## Events Indexed

| Event | Contract |
|---|---|
| `TokenLaunched` | Bonding |
| `Trade` | Bonding (unified buy/sell with `isBuy` flag) |
| `TokenGraduated` | Bonding — includes `tokensInLP`, `lpBurned`, `unsoldBurned` (dynamic LP seeding outputs, see `packages/contracts/AGENTS.md`) |
| `CreatorFeesClaimed` | Bonding |
| `ProtocolFeesClaimed` | Bonding |
| `Buy` | LaunchpadRouter — also bumps `token.organicUsdcRaised` |
| `Sell` | LaunchpadRouter — also decrements `token.organicUsdcRaised` (floored at 0) |
| `Referred` | LaunchpadRouter |
| `Transfer` | FERC20 (factory-registered via `TokenLaunched`) |
| `Swap` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |
| `Sync` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |

### Graduation progress decomposition (`token.organicUsdcRaised`)

Powers the "organic buys vs LT price appreciation" split on the landing-page progress bar. Cumulative net USDC (6dp) that has flowed through LaunchpadRouter for a given token — buys add `usdcIn`, sells subtract `usdcOut`. **Floored at 0** so a late-life sell-off can't produce negative organic.

The API (`apps/api/src/lib/token-enrich.ts`) reads this alongside the current `ltReserve × exchangeRate` value and derives:

- `curveFilled` = `max(supplyFilled, usdFilled)` (whichever trigger is closer to firing).
- `curveFilledOrganic` = `min(organicUsdcRaised / $12K × 100, curveFilled)`.
- `curveFilledLeverageBoost` = `max(curveFilled − curveFilledOrganic, 0)` — never surface a negative boost (product decision: this is a marketing number, not an accounting figure).

When you modify `LaunchpadRouter.Buy`/`Sell` handlers, **also keep the organic counter in sync**. The test suite in `apps/indexer/test/bonding.test.ts` asserts both the `routerTrade` insert and the counter bump.

### Factory Registration (Dynamic Contract Subscriptions)

**FERC20 tokens** are deployed when a token launches. The `FERC20Token` contract source uses `factory` config pointing at the Bonding contract's `TokenLaunched` event. When `TokenLaunched` fires, Ponder extracts the `token` parameter and begins indexing `Transfer` events. The handler in `src/bonding.ts` writes to the `tokenBalance` table.

**HyperSwap V2 pairs** are created when a token graduates. The `HyperSwapPair` contract source uses `factory` config pointing at the Bonding contract's `TokenGraduated` event. When `TokenGraduated` fires, Ponder extracts the `pairAddress` parameter and begins indexing `Swap` and `Sync` events. Handlers in `src/hyperswap.ts` write to the `swap` and `pairReserve` tables.

ABIs imported from `@launchpad/shared`. Full indexing spec in `docs/backend-scope.md`.

## Hosting

Hosted on Railway (persistent process). Dockerfile in this directory. Railway auto-deploys from `main` via GitHub integration (with "Wait for CI" enabled). Railway env vars:
- `DATABASE_URL` — Neon PostgreSQL connection string (shared with API; Ponder isolates into its own schema)
- `PONDER_RPC_URL_999` — Alchemy HyperEVM RPC
- `BONDING_START_BLOCK` — block number of contract deployment (defaults to value in `@launchpad/shared`)
