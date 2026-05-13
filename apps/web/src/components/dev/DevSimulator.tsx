import { useState } from "react";

import styles from "./DevSimulator.module.css";
import { emitMockToken, emitMockTrade } from "../../dev/mockFeed";
import { useTokens } from "../../hooks/useTokens";
import { useTradeFeed } from "../../hooks/useTradeFeed";

import type { Token, Trade } from "../../services/types";

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
