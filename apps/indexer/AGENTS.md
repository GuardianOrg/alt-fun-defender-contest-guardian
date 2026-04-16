# apps/indexer

Ponder EVM indexer. Indexes on-chain events from Alt Fun contracts and HyperSwap V2 pools.

## Events Indexed

| Event | Contract |
|---|---|
| `TokenLaunched` | Bonding |
| `Trade` | Bonding (unified buy/sell with `isBuy` flag) |
| `TokenGraduated` | Bonding |
| `CreatorFeesClaimed` | Bonding |
| `ProtocolFeesClaimed` | Bonding |
| `Buy` | LaunchpadRouter |
| `Sell` | LaunchpadRouter |
| `Referred` | LaunchpadRouter |
| `Transfer` | FERC20 (factory-registered via `TokenLaunched`) |
| `Swap` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |
| `Sync` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |

### Factory Registration (Dynamic Contract Subscriptions)

**FERC20 tokens** are deployed when a token launches. The `FERC20Token` contract source uses `factory` config pointing at the Bonding contract's `TokenLaunched` event. When `TokenLaunched` fires, Ponder extracts the `token` parameter and begins indexing `Transfer` events. The handler in `src/bonding.ts` writes to the `tokenBalance` table.

**HyperSwap V2 pairs** are created when a token graduates. The `HyperSwapPair` contract source uses `factory` config pointing at the Bonding contract's `TokenGraduated` event. When `TokenGraduated` fires, Ponder extracts the `pairAddress` parameter and begins indexing `Swap` and `Sync` events. Handlers in `src/hyperswap.ts` write to the `swap` and `pairReserve` tables.

ABIs imported from `@launchpad/shared`. Full indexing spec in `docs/backend-scope.md`.

## Hosting

Hosted on Railway (persistent process). Dockerfile in this directory. Railway auto-deploys from `main` via GitHub integration (with "Wait for CI" enabled). Railway env vars:
- `DATABASE_URL` — Neon PostgreSQL connection string (shared with API; Ponder isolates into its own schema)
- `PONDER_RPC_URL_999` — Alchemy HyperEVM RPC
- `BONDING_START_BLOCK` — block number of contract deployment (defaults to value in `@launchpad/shared`)
