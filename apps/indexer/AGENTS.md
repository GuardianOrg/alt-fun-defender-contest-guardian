# apps/indexer

Ponder EVM indexer. Indexes on-chain events from bounce.fun contracts and HyperSwap V2 pools.

## Events to Index

| Event | Contract |
|---|---|
| `TokenLaunched` | Bonding |
| `Buy` / `Sell` | Bonding |
| `Graduated` | Bonding |
| `SellCompleted` / `SellPending` | RedemptionRouter |
| `Referred` | RedemptionRouter |
| `Swap` / `Sync` | HyperSwap V2 Pair (graduated pairs only) |
| `Transfer` | FERC20 (optional) |

ABIs imported from `@bounce/shared`. Full indexing spec in `docs/backend-scope.md`.
