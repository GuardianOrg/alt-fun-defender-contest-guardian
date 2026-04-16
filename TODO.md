# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

- **Post-graduation chart pricing**: The chart currently uses bonding curve trades (Ponder `trade` table) to derive token/LT ratios. For graduated tokens trading on HyperSwap, swap events are not yet indexed. When HyperSwap `Swap`/`Sync` indexing is added, update `GET /api/v1/chart/:address` to incorporate post-grad DEX reserve changes for continuous pricing.

Should implement infinite scroll for tokens on home page

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

We don't want to sign for comments

For the amounts where we show the token amounts, we should abbreviate like 10k 1m etc. This is for trades tab, and anywhere else

And should add time for the trades, like 1s ago or whatever

Another nice to have on the UI to make it more dynamic is every couple of seconds (maybe 5) reordering the tokens displayed on the list. The whole thing by descending MC so they kind of compete for top spot and graduation

Change to live feed for the tickers

Add leveraged token breakdown for progress

Change chart days to not take up full screen if not covering period

Chart should be websocket?

IS chart live updating?

Does chart reflect memecoin trades?

Test graduating
