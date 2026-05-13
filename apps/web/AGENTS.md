# apps/web

React 19, Vite, TypeScript, CSS Modules. Dark terminal aesthetic (Courier New, mint green `#4de8b4`). Auth via Privy.

## Pages

| Route | Description |
|---|---|
| `/` | Homepage — asset sidebar, LONG/SHORT token tables, trade/graduation feed |
| `/token/:address` | Token detail — chart, trade panel, trades/holders |
| `/create` | Create token — pair selector, token details, seed buy, preview |

Plus: search modal (Cmd+K), profile panel (right drawer), bridge modal (LI.FI).

## Key Patterns

- Redux Toolkit for UI state (modals, filters, panels)
- TanStack Query for server/async data
- Privy for wallet and contract interactions
- TradingView Lightweight Charts for candlestick charts
- CSS Modules for styling — no Tailwind

## Buttons (mandatory)

Every button-shaped element on the page goes through one of five shared primitives in `src/components/shared/`. Per-component CSS is allowed only for sizing overrides (`height`, `padding`) — never to redeclare hover, active, focus, border, or background. If an existing primitive doesn't fit, add a variant to the primitive (and add a comment in the PR), don't roll a new bespoke button.

| Use case | Primitive | Hover behaviour |
|---|---|---|
| Solid call-to-action (LAUNCH, Connect Wallet, Share) | [`Button`](src/components/shared/Button.tsx) | Filled bg shifts to `--mint-hover` (or variant equivalent) |
| Small data pill — value + optional icon (CA address, wallet address, footer CA, click-to-copy chips) | [`Chip`](src/components/shared/Chip.tsx) | Border becomes `--mint`, bg tints `--mint-bg`, color goes to `--txt` |
| Square icon-only trigger (gear, close, inline copy) | [`IconButton`](src/components/shared/IconButton.tsx) | Color goes to `--mint`, border becomes `--border-2`, bg tints `--mint-bg` |
| Quick-pick toggle chip in a horizontal row (25/50/75/MAX, seed-buy %, slippage %) | [`PresetChip`](src/components/shared/PresetChip.tsx) | Border `--border` → `--border-2`, color `--txt-3` → `--txt` |
| Segment of a mutually-exclusive control (BUY/SELL, tab bars, interval / timeframe / unit pickers) | [`SegmentedButton`](src/components/shared/SegmentedButton.tsx) | Color `--txt-3` → `--txt`, faint white-overlay bg; active state uses tone (`mint`/`red`/`neutral`) plus optional 2px bottom indicator |

For the recurring "copy this wallet address" affordance specifically, use the shared [`CopyAddressButton`](src/components/shared/CopyAddressButton.tsx) wrapper rather than re-rolling `IconButton` + `useCopyState` + the copy/check SVG pair. It guarantees every copy-address surface (profile row, recent-trades feed, trades table, …) shares the same look, hit target, post-copy confirmation window, and `aria-label` format.

A few things that look button-shaped but **are not** in this taxonomy and are documented exceptions:

- The **modal "esc" badge** (`shared/Modal`) — close affordance for every modal, intentionally a kbd-styled pill, not an `IconButton`. See [Modals & overlays](#modals--overlays-mandatory).
- **Clickable list rows** (`TokenRow`, position rows, trade-feed rows, search results) — these are full-row affordances, styled per-component with a `bg-3` hover. Do not migrate these to `Button` / `Chip`.
- **The `LANDING_OVERLAY` page CTA** — landing-page hero element, allowed to break the standard CTA visual since it's not in the dense-panel context.

Do not invent a new variant of any primitive without updating this table at the same time.

## Modals & overlays (mandatory)

Every dim-the-page popup — image lightboxes, search (Cmd+K), profile/earnings, future confirms — uses the shared [`shared/Modal`](src/components/shared/Modal.tsx) component. No exceptions, no hand-rolled overlays. `Modal` owns:

- the dim/blurred backdrop
- the panel chrome (`var(--bg-1)`, `1px solid var(--border-2)`, `border-radius: 3px`, `--shadow-panel`, `modalin` enter animation)
- the close button (esc badge, top-right)
- esc-to-close, click-outside-to-close, focus trap, body scroll lock

Per-modal CSS only sets sizing (width / max-height) via `panelClassName` — never re-declares background / border / radius / shadow / animation. The "esc" badge is the only close affordance; do not add an extra `×` button. If a modal needs a custom header that includes the close (rare), pass `hideCloseButton` to `Modal` and render `<ModalCloseButton>` from the same module — same visual, same behaviour.

Inline anchored popovers (e.g. [`SettingsPopup`](src/components/token/SettingsPopup.tsx)) are **not** modals — they don't dim the page or trap focus, and shouldn't use `Modal`.

## Progress-bar breakdown (`Token.organicFilled` / `Token.leverageBoost`)

Every graduation progress bar is a two-segment render powered by the API's `curveFilledOrganic` / `curveFilledLeverageBoost` fields:

- `organicFilled` (0–100, nullable): curve-fill % from real USDC buys, as a percent of the USD graduation threshold.
- `leverageBoost` (0–100, never negative): curve-fill % from LT price appreciation, derived from the gap between `realLt × currentRate` and the net organic USDC raised (buys − sells, floored at 0).
- `curveFilled` (= `organicFilled + leverageBoost`) is USD-denominated: `realLt × rate / graduationThresholdUsd × 100`, where `graduationThresholdUsd` is set once at `Bonding.initialize` and read live via RPC. The bar tracks dollars raised, not the supply-side AMM lead — see `apps/api/AGENTS.md` on why.

**Rendering rules (see `TokenRow.tsx`, `TokenDetailView.tsx`, `Chart.tsx`):**

1. If `organicFilled === null` (indexer/BounceTech degraded), render a single solid fill of width `curveFilled` — never assume zero for the missing bucket.
2. If the token is `graduated`, hide the split entirely.
3. Row border is mint (long) or red (short); graduating tokens use dedicated graduating styles.

## Functional Spec

Full UI spec (page layouts, trade flows, data sources, contract calls): `docs/frontend-scope.md`
