# Unsorted

# TODO

- Unify client `Trade` interface into `packages/shared` (currently split between `apps/web/src/services/types.ts` and the broadcast payload shape).
- Slow down scrolling tickers
- Implement trending system
- Implement LT Movers Section
- Add Volume stat, show in token page and profile page
- Website design updates?

- Implement creator fees in the zap
- Can we deploy tokens via some proxy template so the deployment is smaller?
- Add some flow for enabling big blocks.
- Vanity addresses
- Handle the case when a user buys more than is available right at the end for bonding graduation, maybe refund them the excess or something.
- Test graduating

# Post graduation

- **Post-graduation chart pricing**: The chart currently uses bonding curve trades (Ponder `trade` table) to derive token/LT ratios. For graduated tokens trading on HyperSwap, swap events are not yet indexed. When HyperSwap `Swap`/`Sync` indexing is added, update `GET /api/v1/chart/:address` to incorporate post-grad DEX reserve changes for continuous pricing.

# Post testing

- Should implement infinite scroll for tokens on home page

# Post Audit (polish)

- Add some link to a bridge or something
- Add transaction status popup thing like Pump fun has
- Another nice to have on the UI to make it more dynamic is every couple of seconds (maybe 5) reordering the tokens displayed on the list. The whole thing by descending MC so they kind of compete for top spot and graduation

# Post launch
