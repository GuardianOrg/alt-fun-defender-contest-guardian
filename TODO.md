# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

- **Post-graduation chart pricing**: The chart currently uses bonding curve trades (Ponder `trade` table) to derive token/LT ratios. For graduated tokens trading on HyperSwap, swap events are not yet indexed. When HyperSwap `Swap`/`Sync` indexing is added, update `GET /api/v1/chart/:address` to incorporate post-grad DEX reserve changes for continuous pricing.

Rename "% Filled" to "Progress"

Should implement infinite scroll for tokens on home page

Don't persist the dismisal of the banner at the top

Implement recent trades

Update the percent buys, to match the percent of supply the user is buying. And update them to 0.5%, 1%, 2%, 3% and 5% max
