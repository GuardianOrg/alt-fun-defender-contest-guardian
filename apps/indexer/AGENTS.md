# apps/indexer

Ponder EVM indexer. Indexes on-chain events from launchpad contracts and HyperSwap V2 pools.

## Events to Index

| Event | Contract |
|---|---|
| `TokenLaunched` | Bonding |
| `Buy` / `Sell` | Bonding |
| `Graduated` | Bonding |
| `Referred` | RedemptionRouter |
| `Swap` / `Sync` | HyperSwap V2 Pair (graduated pairs only) |
| `Transfer` | FERC20 (optional) |

ABIs imported from `@launchpad/shared`. Full indexing spec in `docs/backend-scope.md`.

## Hosting

Hosted on Railway (persistent process). Dockerfile in this directory. Railway env vars:
- `PONDER_RPC_URL_999` — Alchemy HyperEVM RPC
- `BONDING_START_BLOCK` — block number of contract deployment (set after deploy)
