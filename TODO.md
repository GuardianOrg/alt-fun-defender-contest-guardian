# Unsorted

# TODO

- Is Router the right term?
- Can we deploy tokens via some proxy template so the deployment is smaller?
- Add some flow for enabling big blocks.
- Vanity addresses
- Test graduating

# Post Audit

- 1s chart
- We should pass through slippage checks
- Landing page
- In between Test and HYPE 5x Long put /HYPE5L So it’s Test/HYPE5L HYPE 5x Long Or could not add the HYPE5L
- Testing image validation, does this work and how? Max image size also etc? some explicit filter
- Add Geoblocking, block UK, Any sanctioned countries
- Add Terms of Service, Privacy Policy, DMCA Policy
- Add some report feature where users can report tokens that are in breach of something
- Right now DEV and CA are equal-weight buttons. CA is the primary action (traders copy CAs constantly to paste into terminals, wallets, etc.). DEV is secondary context. Can we make CA larger, more prominent, possibly even as the only copy-button and relegate DEV to a smaller info icon that expands on hover, or a smaller pill below. The CA should be the most copy-worthy thing on the page. (https://www.printr.money/)

# Post graduation

- **Post-graduation chart pricing**: The chart currently uses bonding curve trades (Ponder `trade` table) to derive token/LT ratios. For graduated tokens trading on HyperSwap, swap events are not yet indexed. When HyperSwap `Swap`/`Sync` indexing is added, update `GET /api/v1/chart/:address` to incorporate post-grad DEX reserve changes for continuous pricing.

# Post testing

- Should implement infinite scroll for tokens on home page

# Post Audit (polish)

- Add some link to a bridge or something
- Add transaction status popup thing like Pump fun has
- Another nice to have on the UI to make it more dynamic is every couple of seconds (maybe 5) reordering the tokens displayed on the list. The whole thing by descending MC so they kind of compete for top spot and graduation

# Post launch
