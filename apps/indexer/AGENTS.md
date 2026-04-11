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

### Not Yet Indexed

| Event | Contract | Status |
|---|---|---|
| `Swap` / `Sync` | HyperSwap V2 Pair (graduated pairs only) | Needs dynamic pair registration |
| `Transfer` | FERC20 | Deferred (high indexing load, holder counts derived from trade data) |

ABIs imported from `@launchpad/shared`. Full indexing spec in `docs/backend-scope.md`.

## Hosting

Hosted on Railway (persistent process). Dockerfile in this directory. Railway env vars:
- `PONDER_RPC_URL_999` — Alchemy HyperEVM RPC
- `BONDING_START_BLOCK` — block number of contract deployment (set after deploy)
