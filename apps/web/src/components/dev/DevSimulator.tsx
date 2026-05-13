import { useState, useSyncExternalStore } from "react";

import { useLocation } from "react-router";

import styles from "./DevSimulator.module.css";
import {
  clearTokenOverride,
  getTokenOverride,
  setTokenOverride,
  subscribeTokenOverrides,
} from "../../dev/devTokenOverrides";
import { emitMockToken, emitMockTrade } from "../../dev/mockFeed";
import { useToken } from "../../hooks/useToken";
import { useTokens } from "../../hooks/useTokens";
import { useTradeFeed } from "../../hooks/useTradeFeed";
import { cn } from "../../utils/format";

import type { Token, TokenStatus, Trade } from "../../services/types";

// Each simulated trade nudges the curve up by a small random amount —
// matches the rough feel of a real organic buy on an early-stage token
// without burning straight to 100% on a single click. Bounds picked so
// ~15-20 clicks fills a fresh bar, which is a comfortable count for
// QAing the fill-driven glow + graduation transition by hand.
const TRADE_CURVE_BUMP_MIN = 3;
const TRADE_CURVE_BUMP_RANGE = 4;

const STATUS_OPTIONS: ReadonlyArray<{ value: TokenStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "graduating", label: "Graduating" },
  { value: "graduated", label: "Graduated" },
];

// Pulled from the route table at `apps/web/src/app/routes.ts` rather
// than imported because parsing it back out of `:address` would mean
// hauling in a path matcher just to grab a single capture group; the
// dev panel is the only consumer that needs to do this and a literal
// regex keeps the surface minimal.
const TOKEN_PATH_REGEX = /^\/token\/([^/?#]+)/;

function tokenAddressFromPath(pathname: string): string | undefined {
  const match = TOKEN_PATH_REGEX.exec(pathname);
  return match?.[1];
}

/**
 * Dev-only easter egg: a small panel docked next to the footer's
 * Whitepaper / Audit links that fabricates trades and new-token rows
 * so the row-flash UI can be exercised without waiting on real
 * on-chain activity. Hidden in production builds via
 * `import.meta.env.DEV` — the component returns `null` and the
 * bundler eliminates the rest of the module on `vite build`.
 *
 * The panel pulls templates from the same hooks the live UI uses
 * (`useTradeFeed`, `useTokens`), so injected rows look indistinguishable
 * from real ones aside from a stable mock-prefixed id / address. The
 * row-level fade-out is then driven by `useFlashOnNew`, which doesn't
 * know or care whether the new row came from the WS or the mock bus.
 */
export default function DevSimulator() {
  const [open, setOpen] = useState(false);
  const { trades } = useTradeFeed(50);
  const { data: tokens } = useTokens();
  const location = useLocation();
  const tokenAddress = tokenAddressFromPath(location.pathname);

  // Subscribe to override changes for the currently routed token so
  // the panel's status pills + slider reflect the live overlay (e.g.
  // staying in sync if a future surface ever writes into the same
  // store from elsewhere). The `getSnapshot` only walks the map for
  // the address we care about — cheap.
  const override = useSyncExternalStore(
    subscribeTokenOverrides,
    () => getTokenOverride(tokenAddress),
    () => undefined,
  );
  const overrideStatus = override?.status;
  const overrideFill = override?.curveFilledPercent;
  const isGraduatedOverride = overrideStatus === "graduated";

  // Read the live token (already overlay-merged via `useToken` →
  // `applyTokenOverride`) so the "+1 trade" button can tag the
  // injected trade with the token's display name and bump the curve
  // override on top of whatever the bar is currently showing —
  // including any prior bumps. `useToken` no-ops on `undefined`, so
  // it's safe to call unconditionally above the route check.
  const { data: token } = useToken(tokenAddress);

  const simulateTrades = (count: number) => {
    if (trades.length === 0) {
      console.warn("[DevSimulator] no trades to template from yet");
      return;
    }
    for (let i = 0; i < count; i++) {
      const template = trades[Math.floor(Math.random() * trades.length)];
      const mock = mutateTrade(template, i);
      // Stagger so a burst of rows animates one after the other
      // instead of stacking inside a single React commit.
      setTimeout(() => emitMockTrade(mock), i * 90);
    }
  };

  const simulateTokens = (count: number) => {
    if (!tokens || tokens.length === 0) {
      console.warn("[DevSimulator] no tokens to template from yet");
      return;
    }
    for (let i = 0; i < count; i++) {
      const template = tokens[Math.floor(Math.random() * tokens.length)];
      const mock = mutateToken(template, i);
      setTimeout(() => emitMockToken(mock), i * 220);
    }
  };

  /**
   * Inject one synthetic trade for the currently-routed token and
   * nudge its curve override up by a small random delta. The combined
   * effect mimics a real organic buy: the trade lands in the trades
   * tab + global feed (the WS subscriber filter on `tokenAddress`
   * gates the latter to consumers that care), and the curve strip's
   * progress bar visibly grows.
   *
   * Trade payload: clones a real trade from the live feed as a
   * template (preferring one that already belongs to this token so
   * the wallet / amount distribution stays plausible, falling back
   * to any random trade if the feed has nothing for this token yet)
   * and overrides `tokenAddress` + `tokenName` so the row routes back
   * to this page on click.
   *
   * Curve bump: layers on top of the current overlay (or the live API
   * value when no override exists yet), so repeated clicks
   * monotonically progress the bar instead of resetting to a fresh
   * random delta each time. Capped at 100 — past that, the user can
   * use the "Graduating" / "Graduated" status buttons to advance the
   * lifecycle.
   */
  const simulateTokenTrade = () => {
    if (!tokenAddress) return;
    if (trades.length === 0) {
      console.warn("[DevSimulator] no trade templates to clone from yet");
      return;
    }
    const sameToken = trades.filter(
      (t) => t.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
    );
    const pool = sameToken.length > 0 ? sameToken : trades;
    const template = pool[Math.floor(Math.random() * pool.length)];
    const mock = mutateTrade(template, 0);
    emitMockTrade({
      ...mock,
      tokenAddress,
      tokenName: token?.name || mock.tokenName,
    });

    const baseFill =
      override?.curveFilledPercent ?? token?.curveFilled ?? 0;
    const bump =
      TRADE_CURVE_BUMP_MIN + Math.random() * TRADE_CURVE_BUMP_RANGE;
    setTokenOverride(tokenAddress, {
      curveFilledPercent: Math.min(100, baseFill + bump),
    });
  };

  if (!import.meta.env.DEV) return null;

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle dev simulator"
        title="Dev simulator"
      >
        <BugIcon />
        dev
      </button>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Dev simulator">
          <div className={styles.panelHeader}>DEV SIMULATOR</div>
          <div className={styles.group}>
            <div className={styles.groupLabel}>Trades</div>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => simulateTrades(1)}
              >
                +1
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => simulateTrades(5)}
              >
                +5
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => simulateTrades(20)}
              >
                +20
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => simulateTrades(50)}
              >
                spam 50
              </button>
            </div>
          </div>
          <div className={styles.group}>
            <div className={styles.groupLabel}>New tokens</div>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => simulateTokens(1)}
              >
                +1
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => simulateTokens(5)}
              >
                +5
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => simulateTokens(20)}
              >
                +20
              </button>
            </div>
          </div>

          {tokenAddress && (
            <div className={styles.group}>
              {/* Header row carries the group title + a "reset" affordance
               * that clears the override and snaps the page back to the
               * real API response. We only render reset when something
               * is actually overridden, so the row collapses to the
               * label alone in the steady state. */}
              <div className={styles.groupHeader}>
                <div className={styles.groupLabel}>Token state</div>
                {override && (
                  <button
                    type="button"
                    className={styles.resetBtn}
                    onClick={() => clearTokenOverride(tokenAddress)}
                    aria-label="Reset token state override"
                  >
                    reset
                  </button>
                )}
              </div>
              <div className={styles.row}>
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={cn(
                      styles.btn,
                      overrideStatus === opt.value && styles.btnActive,
                    )}
                    onClick={() =>
                      setTokenOverride(tokenAddress, { status: opt.value })
                    }
                    aria-pressed={overrideStatus === opt.value}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {/* Curve % only matters while the bar is in flight — once
               * graduated, `ProgressBar.tsx` collapses to a solid 100%
               * amber fill regardless of `curveFilled`, so the slider
               * would be a no-op. Hidden in that branch. */}
              {!isGraduatedOverride && (
                <div className={styles.sliderGroup}>
                  <div className={styles.sliderRow}>
                    <span className={styles.sliderLabel}>curve</span>
                    <span className={styles.sliderValue}>
                      {overrideFill !== undefined
                        ? `${Math.round(overrideFill)}%`
                        : "—"}
                    </span>
                  </div>
                  <input
                    type="range"
                    className={styles.slider}
                    min={0}
                    max={100}
                    step={1}
                    value={overrideFill ?? 0}
                    onChange={(e) =>
                      setTokenOverride(tokenAddress, {
                        curveFilledPercent: Number(e.target.value),
                      })
                    }
                    aria-label="Override bonding-curve fill percent"
                  />
                </div>
              )}
              {/* "+1 trade" — fabricates a single trade pinned to this
               * token (so it lands in the trades tab + global feed) and
               * nudges the curve override up by a small random delta,
               * stacked on top of the current bar value. Hidden once
               * graduated for the same reason as the slider above:
               * curve % is meaningless past graduation. */}
              {!isGraduatedOverride && (
                <div className={styles.row}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={simulateTokenTrade}
                  >
                    +1 trade
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const BugIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2l1.88 1.88" />
    <path d="M14.12 3.88L16 2" />
    <path d="M9 7.13v-1a3.003 3.003 0 0 1 6 0v1" />
    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" />
    <path d="M12 20v-9" />
    <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
    <path d="M6 13H2" />
    <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
    <path d="M22 13h-4" />
    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
  </svg>
);

/**
 * Synthesise a 40-char hex address. Statistically guaranteed not to
 * collide with any real on-chain token address; the leading `0xdead`
 * sentinel also makes mock rows easy to grep for in the React devtools
 * if something looks off.
 */
function randomMockAddress(): string {
  let hex = "dead";
  for (let i = 0; i < 36; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `0x${hex}`;
}

function randomMockTxId(): string {
  let hex = "beef";
  for (let i = 0; i < 60; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `0x${hex}-0`;
}

/**
 * Clone a real trade with a fresh id / timestamp and a randomised
 * BUY/SELL side + amount so a burst of injected rows reads as varied
 * activity rather than 50 identical clones.
 */
function mutateTrade(template: Trade, i: number): Trade {
  const sideFlip = Math.random() < 0.5;
  const amountScale = 0.3 + Math.random() * 2.4;
  const traderTail = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return {
    ...template,
    id: randomMockTxId(),
    side: sideFlip ? "BUY" : "SELL",
    amountUsd: Math.max(1, template.amountUsd * amountScale),
    timestamp: new Date().toISOString(),
    walletAddress: `0xMK…${traderTail}`,
    walletAddressFull: `0xmock${traderTail.padStart(36, "0")}`,
    // Keep the template's tokenName / tokenAddress so the row links
    // back to a real token detail page when clicked — handy for
    // sanity-checking that the row-level navigation still works on
    // a synthesised row. Override the index suffix so multiple mocks
    // for the same token are still distinguishable in devtools.
    tokenName: template.tokenName || `MOCK${i + 1}`,
  };
}

/**
 * Clone a real token with a fresh address, ticker, and `createdAt`
 * timestamp so it sorts to the top of the homepage list (NEW filter
 * is `createdAt desc`) and renders the new-token flash exactly once.
 */
function mutateToken(template: Token, i: number): Token {
  const suffix = `${i + 1}-${Math.random().toString(36).slice(2, 5)}`;
  return {
    ...template,
    address: randomMockAddress(),
    name: `Mock ${template.name}`,
    ticker: `MOCK${suffix}`.toUpperCase().slice(0, 10),
    createdAt: new Date().toISOString(),
  };
}
