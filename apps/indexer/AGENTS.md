# apps/indexer

Ponder EVM indexer. Indexes on-chain events from launchpad contracts and HyperSwap V2 pools.

## Events Indexed

| Event | Contract |
|---|---|
| `TokenLaunched` | Bonding |
| `Trade` | Bonding (unified buy/sell with `isBuy` flag) |
| `TokenGraduated` | Bonding |
| `CreatorFeesClaimed` | Bonding |
| `ProtocolFeesClaimed` | Bonding |
| `Buy` | RedemptionRouter |
| `Sell` | RedemptionRouter |
| `Referred` | RedemptionRouter |
| `Swap` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |
| `Sync` | HyperSwap V2 Pair (graduated pairs only, factory-registered) |

### Factory Registration (Dynamic Pair Subscriptions)

HyperSwap V2 pair contracts are not known at deploy time — they are created when a token graduates. The indexer uses Ponder's factory pattern to dynamically register pairs:

- The `HyperSwapPair` contract source in `ponder.config.ts` uses `factory` config pointing at the Bonding contract's `TokenGraduated` event.
- When `TokenGraduated` fires, Ponder extracts the `pairAddress` parameter and begins indexing `Swap` and `Sync` events from that pair.
- Handlers in `src/hyperswap.ts` write to the `swap` and `pairReserve` tables.

### Not Yet Indexed

| Event | Contract | Status |
|---|---|---|
| `Transfer` | FERC20 | Deferred (high indexing load, holder counts derived from trade data) |

ABIs imported from `@launchpad/shared`. Full indexing spec in `docs/backend-scope.md`.

## Hosting

Hosted on Railway (persistent process). Dockerfile in this directory. Railway env vars:
- `DATABASE_URL` — Neon PostgreSQL connection string (shared with API; Ponder isolates into its own schema)
- `PONDER_RPC_URL_999` — Alchemy HyperEVM RPC
- `BONDING_START_BLOCK` — block number of contract deployment (defaults to value in `@launchpad/shared`)
