# Frontend Scope

Dark terminal aesthetic (Bloomberg terminal, Courier New, mint green `#4de8b4`). Auth via Privy (social login, embedded wallets, WalletConnect).

---

## Global Layout

1. **Leverage explainer banner** (top) — dismissible per session
2. **Header** — logo, nav (MARKETS, PROFILE), search (Cmd+K), UTC clock, wallet connect, "launch a levered token" button
3. **Asset ticker tape** — scrolling bar: underlying asset prices + 24h changes
4. **Page content**
5. **Search modal** (overlay, Cmd+K) — trending tokens with sparklines when empty, search results when typing
6. **Profile panel** (right drawer) — Balances + Creator Rewards tabs

---

## Homepage (`/`)

Three-column: left sidebar | center token table | right panel.

**Left sidebar:** asset prices with 24h %, available LT pairs with active token count, create button.

**Token table:** filter tabs (TRENDING, NEW, LT MOVERS, GRADUATING, GRADUATED, ALL). Split into LONG and SHORT columns with independent sort. Each row: icon, name + leverage badge, LT name, 24h change, progress bar (dual fill: buy pressure + leverage boost), market cap. Clickable → `/token/:address`.

**Right panel:** recent trades feed, graduating soon, top LT movers, my positions (when connected).

All data updates in real-time via WebSocket.

---

## Token Detail (`/token/:address`)

Two-column: left (hero, chart, curve strip, tabs) | right (trade panel, 300px).

**Hero:** token icon, name + LT badge, creator address, social links, contract address (copyable), market cap, 24h change, volume, curve fill %, leverage multiplier, share button.

**Chart:** TradingView Lightweight Charts, candlestick. Intervals: 1m, 5m, 15m, 1h, 4h, 1D. Underlying asset overlay toggle (amber line). Decomposition stats: "buys +X.X%" and "lev +X.X%".

**Curve strip:** USDC raised, progress bar, graduation threshold. "Graduating" label with animation when close. Hidden for graduated tokens.

**Tabs:** TRADES (live table with wallet, side, amounts, time), COMMENTS (input + list), HOLDERS (rank, wallet, balance, % supply).

**Trade panel:** Buy/Sell toggle. Slippage popup (0.5%, 1%, 2%, 5%, custom). Amount input (USDC/token toggle). Quick buttons: Reset, $100, $500, $1K, Max. Estimate line. CTA states: CONNECT WALLET / APPROVING USDC / BUYING / SELLING / CONFIRMED / RETRY.

Creator badge at bottom (visible when wallet = creator): volume, earned, claimable, claim button.

**5x warning:** yellow banner on 5x tokens — "significantly more volatility decay, recommended for short-term."

**States:** `active` = normal + curve strip. `graduating` = animated glow + trade panel banner. `graduated` = curve strip hidden, chart continues with pool trades.

---

## Create Token (`/create`)

Two-column: left (form) | right (live preview card).

1. **Choose pair:** direction (LONG/SHORT) → underlying asset grid → leverage selector (2x, 3x, 5x). 5x needs extra confirmation.
2. **Token details:** name, ticker, description, image upload.
3. **Seed buy** (optional): USDC amount with preset buttons.
4. **Review & launch:** approve USDC (if seed buy) → `Bonding.launch()` → `POST /tokens` → redirect to token page.

---

## Profile Panel (drawer)

**Balances tab:** total portfolio value, list of held tokens (icon, name, amount, USD value, 24h change). Data: `GET /portfolio/:wallet`.

**Creator Rewards tab:** single claimable USDC figure + claim button (`FeeVault.claim()`). Balance is pooled across every token the creator has launched. Per-token `earned` column is sourced from `ApiToken.creatorFeesUsd`, a running counter on the indexer's `token` row bumped on every `FeeVault:FeeAccrued` event (no per-token API round-trip).

---

## Trade Flows

**Buy:** enter USDC → see estimated tokens → BUY → Privy login if needed → USDC approve if first buy → `Zap.buy()` → confirmation.

**Sell:** enter token amount → see estimated USDC → SELL → Token approve if first sell → `Zap.sell()` → USDC arrives atomically. If sell exceeds the LT's idle USDC buffer (`baseAssetBalance()`), the trade panel shows a warning with the max sellable amount and advises selling in smaller chunks. The buffer replenishes in ~10s after each sell.

---

## Contract Calls

| Action | Function |
|---|---|
| Buy | `Zap.buy(token, usdcAmount, minOut, referrer)` |
| Sell | `Zap.sell(token, tokenAmount, minUsdcOut)` |
| Launch token | `Zap.createToken({ name, ticker, ltAddress, description, image, urls }, seedUsdcAmount)` |
| Claim creator fees | `FeeVault.claim()` (USDC, pooled across all of the creator's tokens) |
| USDC approval | `USDC.approve(zap, amount)` |
| Token approval | `Token.approve(zap, amount)` |

---

## Referral

Read `?ref=` URL param, store in session. Pass as `referrer` to `buy()`. `address(0)` if none.

---

## Mobile

Single column layouts. Token detail: stacked (chart → trade panel as bottom sheet → tabs). Profile: full-width bottom drawer.

---

## Image Upload

Token creation uses file upload (not URL paste). Images are uploaded to the API (`POST /images`), which moderates and stores them in Cloudflare R2. Accepted formats: JPEG, PNG, GIF, WebP. Max size: 5MB.

---

## Data Sources

| Data | Source |
|---|---|
| Token list | `GET /tokens` |
| Token detail | `GET /tokens/:address` |
| Chart data | `GET /tokens/:address/chart` |
| Asset prices / LT rates | `GET /assets` |
| Portfolio | `GET /portfolio/:wallet` |
| Creator stats | `GET /creator/:wallet` |
| Live trades | WebSocket `trade` |
| Live prices | WebSocket `price` |
| Graduations | WebSocket `graduation` |
| New tokens | WebSocket `newToken` |
| Platform stats | WebSocket `stats` |
