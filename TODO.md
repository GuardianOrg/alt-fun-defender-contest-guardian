# TODO

- **Deploy note (market data snapshots)**: The indexer now writes a `tokenSnapshot` row (curve state only: `curveSupply`, `ltReserve`) on every `Bonding:Trade`, read by `/api/v1/market-data`. Historical LT exchange rates are read from BounceTech's existing Neon DB (`token_snapshots_v1`) via `BOUNCETECH_DATABASE_URL` — no indexer reads of `exchangeRate()` (reading LT views at past blocks on HyperEVM reverts because of the Hyperliquid precompile). Railway-hosted Ponder needs a full re-sync from `startBlock` to populate `tokenSnapshot` history. During the first 24h after re-sync, `change24h` will render `—` for tokens that haven't traded within the window on the live chain (their pre-trade curve state isn't snapshotted yet); as soon as the next trade lands, subsequent reads pick up accurately. Plan a short maintenance window when deploying.

Look into how overflow bonding buys are handled

Trending icon issue

See effort to charge fees in AMM vs in Zap

- Shows Loading token when you visit token page, should instead show the page, and just a loading state for the specific elements we need

- White background on connect button

- **Post-graduation chart pricing**: The chart currently uses bonding curve trades (Ponder `trade` table) to derive token/LT ratios. For graduated tokens trading on HyperSwap, swap events are not yet indexed. When HyperSwap `Swap`/`Sync` indexing is added, update `GET /api/v1/chart/:address` to incorporate post-grad DEX reserve changes for continuous pricing.

Should implement infinite scroll for tokens on home page

Can we deploy tokens via some proxy template so the deployment is smaller?

Add some flow for enabling big blocks.

Vanity addresses

Add transaction status popup thing like Pump fun has

Another nice to have on the UI to make it more dynamic is every couple of seconds (maybe 5) reordering the tokens displayed on the list. The whole thing by descending MC so they kind of compete for top spot and graduation

Change chart days to not take up full screen if not covering period

Chart should be websocket?

IS chart live updating?

Does chart reflect memecoin trades?

Test graduating

recent trades should come in one by one

My positions on right says "Connect wallet to view" even though already connected

K keyboard shortcut in search box hits the roof

Create button in bottom left doesn't fit

Implement trending system

Implement LT Movers Section

Add Volume stat, show in token page and profile page

Add some link to a bridge or something

# Post launch
