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

## Functional Spec

Full UI spec (page layouts, trade flows, data sources, contract calls): `docs/frontend-scope.md`
