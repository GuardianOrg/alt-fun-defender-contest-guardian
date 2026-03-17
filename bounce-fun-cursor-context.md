# bounce.fun — Frontend Cursor Context

## What This Is

This repo is the **frontend skeleton** for bounce.fun, a memecoin launchpad on HyperEVM where every token is paired with a BounceTech Leveraged Token (LT) as its reserve asset. The frontend is a static mock-up / design skeleton to be used as the foundation for the production React build. No contracts exist yet — those come in April 2026.

The current deliverable is `bounce-app.html` — a single-file SPA with three views (terminal/market, token detail, create) wired together via a JS router. This file is the design source of truth.

---

## Product Overview

**Core mechanic:** A memecoin's bonding curve holds a Leveraged Token (e.g. HYPE 3× Long) as its reserve asset instead of a base asset like SOL or USDC. This means the token appreciates from two sources simultaneously: buy pressure from traders, and NAV appreciation from the underlying asset moving in the leveraged direction.

**User-facing language:**
- The LT NAV contribution to price movement is called **"leverage boost"** — use this term consistently, never "HYPE boost" or "LT gain"
- Reserve asset = LT (Leveraged Token)
- Graduation = when the curve's LT reserve USD value hits the threshold (~$12K–$15K, TBD)
- Post-graduation the token trades on Project X (HyperEVM DEX) as a MEMECOIN/LT pair

**Token categories:**
- **Bullish** — paired with a Long LT (e.g. HYPE 2× Long). Gains when underlying pumps.
- **Bearish** — paired with a Short LT (e.g. ETH 2× Short). Gains when underlying dumps.

---

## Domain & Branding

- **Domain:** bounce.fun (confirmed)
- **Tagline:** perps × memes
- **Color palette:**
  - Background: `#0a1e1b`
  - Mint / primary accent: `#4de8b4`
  - Red / short: `#f05050`
  - Amber / leverage boost: `#f0b429`
  - Text: `#eafaf4`
- **Font:** Courier New throughout (Bloomberg terminal aesthetic)
- **Logo:** `BOUNCE.FUN` in mint, `.FUN` in white

---

## Flagship Example Token: THEHOUSE

The UI mock-up uses THEHOUSE as the example token throughout. Do not replace it with generic placeholder names.

- **Name:** THEHOUSE
- **Ticker:** HOUSE
- **Pair:** HYPE 3× Long
- **Description:** "The house is long."
- **Avatar:** 🏠 (green Monopoly house)
- **Mcap at example state:** $188K
- **Curve fill:** 92% (graduating state)
- **24h change:** +62.1% (13.4% buy momentum + 48.7% leverage boost)

The token is shown in a graduating state — ambient background pulse, pulsing progress bar, graduating badge on the right panel.

---

## Current File Structure

```
bounce-app.html          ← Single-file SPA, source of truth for all UI
bounce-fun-cursor-context.md  ← This file
```

The single HTML file contains three views rendered in the same DOM, switched via a `nav()` JS router:
- `#view-terminal` — market overview (Bloomberg terminal style)
- `#view-token` — individual token detail page
- `#view-create` — create a new token flow

---

## View 1: Terminal (Market Overview)

**Layout:** Header → Asset tape → [Sidebar | Main content | Right panel]

**Sidebar (200px):**
- Live asset prices: HYPE, ETH, SOL, BTC
- Platform stats: tokens live, graduating, 24h volume, graduated today, total raised
- Pairs filter: HYPE Long, ETH Short, SOL Short, BTC Long with counts
- "Create / launch a levered memecoin" CTA button at bottom

**Main content:**
- Command bar with VIEW tabs: TRENDING / NEW / ⚡ LT MOVERS / GRADUATING / ALL
- Split LONG / SHORT columns, each with table rows
- Token rows: icon | name + pair | 24h change | dual-fill progress bar | mcap
- Progress bar has two segments: dark green (buy pressure) + bright aqua `#00ffcc` (leverage boost)
- Hovering a bar shows tooltip with buy% vs leverage boost% split
- Graduating rows: pulsing animation, GRADUATING badge, ambient row glow
- Row reordering animation every 4–9s (simulates live ranking changes)

**Right panel (220px):**
- Recent trades live feed (500ms injection)
- Graduating soon
- Top LT movers
- My positions with net P&L

**Search modal (⌘K):**
- Trending token cards with sparklines
- Live search filtering by name/ticker
- Click any result → token detail view

---

## View 2: Token Detail Page

**Header:** Same as terminal. MARKETS tab navigates back to terminal.

**Hero section:**
- Avatar + name + LT badge
- `Market Cap` label → large Oswald number (e.g. `$188K`) → 24h change below
- ATH badge (pulsing amber glow) + progress bar to ATH
- Secondary stats: 24h vol, curve filled % — **no leverage boost here** (it lives in the decomp panel only)
- CA copy button — copies full address, shows ✓ confirmation for 2s
- Social links: 𝕏 TG 🌐

**Chart area:**
- Canvas candlestick chart (custom drawn, not TradingView)
- Interval tabs: 1m / 5m / 15m / 1h / 4h / 1D
- "HYPE overlay" checkbox — overlays underlying asset price as amber line

**Decomp panel (below chart):**
- Total 24h: e.g. `+62.1%`
- Buy momentum: e.g. `+13.4%` (trade activity)
- **Leverage boost:** e.g. `+48.7%` (shown in amber, with sub-label e.g. `+16.2% × 3×`)
- "↗ share this breakdown" button — copies formatted text to clipboard

**Progress bar:**
- Dark green segment = buy pressure
- Bright aqua `#00ffcc` segment = leverage appreciation
- Hover tooltip shows split
- Legend below bar

**Bottom tabs:** trades | comments | holders
- Trades: live feed injected every 1.2s with flash highlight
- Comments: post as connected wallet, newest first
- Holders: ranked table, creator flagged in amber

**Right panel (300px):**
- Graduating badge (pulsing) when >80% filled
- BUY / SELL toggle
- USDC amount input + quick amounts ($50 / $100 / $500 / $1K)
- Estimate box: tokens received, price impact, fee (0.5%), total
- Slippage selector: 0.5% / 1% / 2%
- Action button: BUY THEHOUSE / SELL THEHOUSE
- Token info: contract (clickable copy), supply, pair, status

---

## View 3: Create Token

**Layout:** Two-column (form left, preview right)

**Step 1 — Choose your pair:**
- LONG / SHORT direction buttons with mini sparkline SVGs (green uptrend / red downtrend)
- Asset grid: HYPE, ETH, BTC, SOL, ARB, OP
- Leverage: 2× / 3×
- Pair summary shows selected LT name + today's % change
- "powered by Hyperliquid perps" badge with HL logo (two inward chevrons `><`)

**Step 2 — Token details:**
- Name (max 32 chars), ticker (max 8 chars)
- Description (max 280 chars)
- Image upload (JPEG/PNG/GIF, max 5MB, IPFS)
- Social links toggle (expands to 𝕏, Telegram, Website)

**Step 3 — Seed buy (optional):**
- USDC amount input
- % ownership shortcuts: 1% / 10% / 30% / 50% / 80% with dollar costs
- Stats: tokens received, % of supply, curve filled %

**Preview column (sticky):**
- Live token card (updates as name/ticker typed)
- Asset chart (HYPE/USD etc) — "your token moves 2× this"
- Info box: "HYPE 2× Long — if HYPE rises 10%, your token moves up ~20% with zero buys."

---

## Navigation

All navigation is via the `nav()` JS function — no href links, no window.location, no history.back().

```javascript
nav('terminal')  // → market overview
nav('token')     // → THEHOUSE detail page  
nav('create')    // → create token flow
```

- Terminal token rows → `nav('token')`
- Search results → `nav('token')`
- Launch buttons → `nav('create')`
- Logo + MARKETS tab → `nav('terminal')`

---

## Fee Model (for UI display only)

| Fee | Rate | Applied on | Notes |
|---|---|---|---|
| Curve fee (buy) | 0.5% | USD nominal | Split 0.4% protocol / 0.1% creator |
| Curve fee (sell) | 0.5% | USD nominal | Same split |
| LT redemption fee | 0.3% | Notional (USD × leverage) | Sells only, 100% protocol |

Round-trip cost at 2× leverage: $1.60 per $100 (vs $2.50 pump.fun, $2.00 LiquidLaunch)

---

## Key Terminology Reference

| Use this | Not this |
|---|---|
| leverage boost | HYPE boost, LT gain, leverage appreciation |
| bonding curve | curve, bond |
| graduation | migrate, launch |
| seed buy | dev buy, initial buy |
| curve filled | progress, bonding |
| Project X | DEX (when referring to the specific post-grad venue) |
| LT (Leveraged Token) | leveraged token (capitalise) |

---

## Live Data (Mock Values — Replace with Real)

```javascript
// Asset prices (tape)
HYPE: $18.42 (+8.2%)
ETH:  $2,041 (-3.1%)
BTC:  $82,400 (+1.4%)
SOL:  $122 (-5.8%)

// THEHOUSE example state
mcap:        $188K
24h change:  +62.1%
buy momentum: +13.4%
leverage boost: +48.7% (HYPE +16.2% × 3×)
curve filled: 92% ($13,800 of $15,000)
volume:      $84K
ATH:         $220K (85% of ATH)
```

---

## Production Build Notes (for when contracts are ready)

- Replace JS router with React Router (real URLs: `/`, `/token/:address`, `/create`)
- Chart: swap canvas implementation for TradingView Lightweight Charts
- Trade feed: WebSocket subscription to Ponder indexer events
- Token list + prices: GraphQL queries to Ponder indexer
- LT NAV / exchange rate: read directly from BounceTech contracts onchain (no oracle)
- Wallet: wagmi + viem (HyperEVM compatible)
- Post-graduation DEX: Project X pool on HyperEVM

**Graduation threshold:** $12K or $15K — to be finalised before contracts are written.

---

## What Not To Change

- The "perps × memes" tagline
- The LONG/SHORT split column layout on the terminal
- The dual-fill progress bar (dark green buy + bright aqua leverage boost)
- The decomp panel structure (total / buy momentum / leverage boost)
- The Courier New font throughout
- THEHOUSE as the example token
- "The house is long." as the token description
