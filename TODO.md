# Unsorted

# TODO

- Website design updates?
- Creator claimable on token page should be open by default
- Testing image validation, does this work and how? Max image size also etc? some explicit filter
- Name or symbol validation? (min 1 char for each, max 34 name, max 10 symbol)
- Add Geoblocking, block UK, Any sanctioned countries
- Add Terms of Service, Privacy Policy, DMCA Policy
- Add some report service
- Settings is hard to see, and should be a cog not a sun
- First should just be label dev and copiable and is more important and needs to be more prominent. People will copy this and share it so need that way more prominent and easier to copy

- Can we improve the Approving UX? Infinite approve the USDC, and some permit stuff for the memecoins?
- Is Router the right term?
- Ability to change graduation threshold (what happens with existing tokens?)
- Charge fees only in the router, and then only in USDC
- Claimed here but total earned and previously claimed reset
- Can we deploy tokens via some proxy template so the deployment is smaller?
- Add some flow for enabling big blocks.
- Vanity addresses
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
