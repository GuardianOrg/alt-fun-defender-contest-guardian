# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

- **Post-graduation chart pricing**: The chart currently uses bonding curve trades (Ponder `trade` table) to derive token/LT ratios. For graduated tokens trading on HyperSwap, swap events are not yet indexed. When HyperSwap `Swap`/`Sync` indexing is added, update `GET /api/v1/chart/:address` to incorporate post-grad DEX reserve changes for continuous pricing.
