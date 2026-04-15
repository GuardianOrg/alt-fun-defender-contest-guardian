# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

- **Post-graduation chart pricing**: The chart currently uses bonding curve trades (Ponder `trade` table) to derive token/LT ratios. For graduated tokens trading on HyperSwap, swap events are not yet indexed. When HyperSwap `Swap`/`Sync` indexing is added, update `GET /api/v1/chart/:address` to incorporate post-grad DEX reserve changes for continuous pricing.

Buy reverting on Yves token

Images only show on the domain they were uploaded on

Rename "% Filled" to "Progress"

Should implement infinite scroll for tokens on home page

Don't persist the dismisal of the banner at the top

Implement recent trades

Update the percent buys, to match the percent of supply the user is buying. And update them to 0.5%, 1%, 2%, 3% and 5% max

Change min transaction size to $20

Change chart Y axis to market cap

Add market cap to the stats, currently always shows as $20

Add some flow for enabling big blocks.

Can we deploy tokens via some proxy template so the deployment is smaller?

Vanity addresses

Change sell button options to percentages, 10, 25, 50, 75, 100

Add transaction status popup thing like Pump fun has
