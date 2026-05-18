# apps/web

React 19, Vite, TypeScript, CSS Modules. Dark terminal aesthetic (Courier New, mint green `#4de8b4`). Auth via Privy.

## Pages

| Route             | Description                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `/`               | Homepage — asset sidebar, LONG/SHORT token tables, trade/graduation feed |
| `/token/:address` | Token detail — chart, trade panel, trades/holders                        |
| `/create`         | Create token — pair selector, token details, seed buy, preview           |

Plus: search modal (Cmd+K), profile panel (right drawer), bridge modal (LI.FI).

## Key Patterns

- Redux Toolkit for UI state (modals, filters, panels)
- TanStack Query for server/async data
- Privy for wallet and contract interactions
- TradingView Lightweight Charts for candlestick charts
- CSS Modules for styling — no Tailwind

## Buttons (mandatory)

Every button-shaped element on the page goes through one of five shared primitives in `src/components/shared/`. Per-component CSS is allowed only for sizing overrides (`height`, `padding`) — never to redeclare hover, active, focus, border, or background. If an existing primitive doesn't fit, add a variant to the primitive (and add a comment in the PR), don't roll a new bespoke button.

| Use case                                                                                             | Primitive                                                      | Hover behaviour                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Solid call-to-action (LAUNCH, Connect Wallet, Share)                                                 | [`Button`](src/components/shared/Button.tsx)                   | Filled bg shifts to `--mint-hover` (or variant equivalent)                                                                            |
| Small data pill — value + optional icon (CA address, wallet address, footer CA, click-to-copy chips) | [`Chip`](src/components/shared/Chip.tsx)                       | Border becomes `--mint`, bg tints `--mint-bg`, color goes to `--txt`                                                                  |
| Square icon-only trigger (gear, close, inline copy)                                                  | [`IconButton`](src/components/shared/IconButton.tsx)           | Color goes to `--mint`, border becomes `--border-2`, bg tints `--mint-bg`                                                             |
| Quick-pick toggle chip in a horizontal row (25/50/75/MAX, seed-buy %, slippage %)                    | [`PresetChip`](src/components/shared/PresetChip.tsx)           | Border `--border` → `--border-2`, color `--txt-3` → `--txt`                                                                           |
| Segment of a mutually-exclusive control (BUY/SELL, tab bars, interval / timeframe / unit pickers)    | [`SegmentedButton`](src/components/shared/SegmentedButton.tsx) | Color `--txt-3` → `--txt`, faint white-overlay bg; active state uses tone (`mint`/`red`/`neutral`) plus optional 2px bottom indicator |

For the recurring "copy this wallet address" affordance specifically, use the shared [`CopyAddressButton`](src/components/shared/CopyAddressButton.tsx) wrapper rather than re-rolling `IconButton` + `useCopyState` + the copy/check SVG pair. It guarantees every copy-address surface (profile row, recent-trades feed, trades table, …) shares the same look, hit target, post-copy confirmation window, and `aria-label` format.

A few things that look button-shaped but **are not** in this taxonomy and are documented exceptions:

- The **modal close badge** (`shared/Modal`) — close affordance for every modal, a small `×` glyph in a kbd-styled square, not an `IconButton`. See [Modals & overlays](#modals--overlays-mandatory).
- **Clickable list rows** (`TokenRow`, position rows, trade-feed rows, search results) — these are full-row affordances, styled per-component with a `bg-3` hover. Do not migrate these to `Button` / `Chip`.

Do not invent a new variant of any primitive without updating this table at the same time.

## Modals & overlays (mandatory)

Every dim-the-page popup — image lightboxes, search (Cmd+K), profile/earnings, future confirms — uses the shared [`shared/Modal`](src/components/shared/Modal.tsx) component. No exceptions, no hand-rolled overlays. `Modal` owns:

- the dim/blurred backdrop
- the panel chrome (`var(--bg-1)`, `1px solid var(--border-2)`, `border-radius: 3px`, `--shadow-panel`, `modalin` enter animation)
- the close button (`×` badge, top-right)
- esc-to-close, click-outside-to-close, focus trap, body scroll lock

Per-modal CSS only sets sizing (width / max-height) via `panelClassName` — never re-declares background / border / radius / shadow / animation. The `×` badge is the only close affordance; do not add a second close button. If a modal needs a custom header that includes the close (rare), pass `hideCloseButton` to `Modal` and render `<ModalCloseButton>` from the same module — same visual, same behaviour.

Inline anchored popovers (e.g. [`SettingsPopup`](src/components/token/SettingsPopup.tsx)) are **not** modals — they don't dim the page or trap focus, and shouldn't use `Modal`.

## Token images (mandatory)

Every `<img>` that renders an R2-served token logo goes through [`transformImageUrl`](src/utils/image.ts) + [`srcSetFor`](src/utils/image.ts) from `src/utils/image.ts`. Cloudflare Image Transformations are enabled on the `alt.fun` zone (Speed → Optimization → Image Resizing); the helper rewrites the request through `/cdn-cgi/image/width=<w>,quality=85,format=auto/<path>` so each render gets a resized AVIF/WebP sized for its slot. Token logos are uploaded at 400×400+ and rendered into 28–96 px squares — the unrewritten PNG/JPEG is the single largest first-paint cost on the home page (~30 logos at 50–200 KB each → ~30 AVIFs at <10 KB each after this helper).

Render-site contract:

- Pass the **CSS pixel width of the rendered slot** to `transformImageUrl`, not 2x. The helper's companion `srcSetFor(src, w)` builds the `1x`/`2x` retina pair automatically — the browser picks `2x` on `devicePixelRatio ≥ 2` displays.
- Always set explicit `width` and `height` attributes on the `<img>` matching the slot — they prevent CLS while the image decodes and let the browser reserve the box during the network round-trip.
- Set `loading="lazy"` + `decoding="async"` on off-the-fold sites (token row icons, search results, position rows). Leave the hero avatar / above-the-fold sites eager so the largest contentful paint isn't gated on the lazy queue.
- Pass `token.image` (or `imageUrl`) unconditionally — the helper short-circuits cleanly for the public `DEFAULT_TOKEN_IMAGE` (root-relative), `blob:` / `data:` upload previews on the create page, foreign origins, and local dev's `localhost:8787` API (the `.alt.fun`-suffix gate). No per-site bypass needed.
- Omit `srcSet` entirely (`srcSet={srcSetFor(...) || undefined}`) when the helper short-circuits; never feed the browser a `<url> 1x, <url> 2x` line that resolves to the same byte range twice.

Wired sites today — match the width to your slot when adding a new one:

| Site | Slot | Width arg |
|---|---|---|
| [`TokenRow`](src/components/terminal/TokenRow.tsx) | 4rem (64px) | `64` |
| [`HeroSection`](src/components/token/HeroSection.tsx) avatar | 6rem (96px) | `96` |
| [`ProfileView`](src/components/profile/ProfileView.tsx) balance / rewards rows | 4rem (64px) | `64` |
| [`TransferOwnershipTab`](src/components/profile/TransferOwnershipTab.tsx) | 4rem (64px) | `64` |
| [`RightPanel`](src/components/terminal/RightPanel.tsx) position rows | 1.6rem (~26px) | `32` |
| [`RewardsTab`](src/components/layout/RewardsTab.tsx) token cards | 1.75rem (28px) | `32` |
| [`SearchTrendingCard`](src/components/layout/SearchTrendingCard.tsx) / [`SearchResultsList`](src/components/layout/SearchResultsList.tsx) | 26–28px | `32` |
| [`TradePanelInput`](src/components/token/TradePanelInput.tsx) coin icon | ~28px | `32` |

Documented exceptions:

- **The lightbox in `HeroSection`** renders the original image at full screen (`min(90vw, 32rem)`) — left untouched on purpose so the user sees the canonical asset when they click the avatar.
- **Non-R2 images** (HyperLiquid logo, USDC icon, asset icons, profile faces, Privy chrome) are bundled local assets or third-party icons. The helper is a no-op against foreign hosts so calling it would be safe but pointless — skip it. Don't repurpose this rule for local SVGs / bundled PNGs.

Tests live in [`src/utils/image.test.ts`](src/utils/image.test.ts) and cover every short-circuit branch (default image, blob, data, foreign origin, double-wrap, undefined, local dev). Adding a new opt or a new short-circuit means adding the matching test in the same commit.

## Progress-bar breakdown (`Token.organicFilled` / `Token.leverageBoost`)

Every graduation progress bar is a two-segment render powered by the API's `curveFilledOrganic` / `curveFilledLeverageBoost` fields:

- `organicFilled` (0–100, nullable): curve-fill % from real USDC buys, as a percent of the USD graduation threshold.
- `leverageBoost` (0–100, never negative): curve-fill % from LT price appreciation, derived from the gap between `realLt × currentRate` and the net organic USDC raised (buys − sells, floored at 0).
- `curveFilled` (= `organicFilled + leverageBoost`) is USD-denominated: `realLt × rate / graduationThresholdUsd × 100`, where `graduationThresholdUsd` is a 9000 USDC const value. The bar tracks dollars raised, not the supply-side AMM lead — see `apps/api/AGENTS.md` on why.

**Rendering rules (see `TokenRow.tsx`, `TokenDetailView.tsx`, `Chart.tsx`):**

1. If `organicFilled === null` (indexer/BounceTech degraded), render a single solid fill of width `curveFilled` — never assume zero for the missing bucket.
2. If the token is `graduated`, hide the split entirely.
3. Row border is mint (long) or red (short); graduating tokens use dedicated graduating styles.

## Functional Spec

Full UI spec (page layouts, trade flows, data sources, contract calls): `docs/frontend-scope.md`
