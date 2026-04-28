# apps/web

React 19, Vite, TypeScript, CSS Modules. Dark terminal aesthetic (Courier New, mint green `#4de8b4`). Auth via Privy.

## Pages

| Route | Description |
|---|---|
| `/` | Homepage — asset sidebar, LONG/SHORT token tables, trade/graduation feed |
| `/token/:address` | Token detail — chart, trade panel, trades/comments/holders |
| `/create` | Create token — pair selector, token details, seed buy, preview |

Plus: search modal (Cmd+K), profile panel (right drawer), bridge modal (LI.FI).

## Key Patterns

- Redux Toolkit for UI state (modals, filters, panels)
- TanStack Query for server/async data
- Privy for wallet and contract interactions
- TradingView Lightweight Charts for candlestick charts
- CSS Modules for styling — no Tailwind

## Progress-bar breakdown (`Token.organicFilled` / `Token.leverageBoost`)

Every graduation progress bar is a two-segment render powered by the API's `curveFilledOrganic` / `curveFilledLeverageBoost` fields:

- `organicFilled` (0–100, nullable): curve-fill % from real USDC buys, as a percent of the USD graduation threshold.
- `leverageBoost` (0–100, never negative): curve-fill % from LT price appreciation, derived from the gap between `realLt × currentRate` and the net organic USDC raised (buys − sells, floored at 0).
- `curveFilled` (= `organicFilled + leverageBoost`) is USD-denominated: `realLt × rate / graduationThresholdUsd × 100`. The bar tracks dollars raised, not the supply-side AMM lead — see `apps/api/AGENTS.md` on why.

**Rendering rules (see `TokenRow.tsx`, `TokenDetailView.tsx`, `Chart.tsx`):**

1. If `organicFilled === null` (indexer/BounceTech degraded), render a single solid fill of width `curveFilled` — never assume zero for the missing bucket.
2. If the token is `graduated`, hide the split entirely.
3. `leverageBoost > 15` flips the row border to amber (the "LT mover" highlight).

**Filter/sort:** the `lt-movers` tab orders by `leverageBoost` descending. That's still the intended behaviour with the new semantics — a high `leverageBoost` means the LT's pump is doing real work toward graduation.

## Functional Spec

Full UI spec (page layouts, trade flows, data sources, contract calls): `docs/frontend-scope.md`
