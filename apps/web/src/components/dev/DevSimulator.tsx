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
import { useTokenMarketStats } from "../../hooks/useTokenMarketStats";
import { useTokens } from "../../hooks/useTokens";
import { useTradeFeed } from "../../hooks/useTradeFeed";
import { cn } from "../../utils/format";

import type { Token, TokenStatus, Trade } from "../../services/types";

// Small enough that manual QA needs several clicks to reach graduation.
const TRADE_CURVE_BUMP_MIN = 3;
const TRADE_CURVE_BUMP_RANGE = 4;

// Mcap QA bumps: clear visual deltas without jumping orders of magnitude.
const MCAP_PUMP_PCT_MIN = 0.06;
const MCAP_PUMP_PCT_RANGE = 0.12;
const MCAP_PUMP_COLD_START_USD = 25_000;
// Keep down-roll animation alive after repeated dumps.
const MCAP_DUMP_FLOOR_USD = 1;

const STATUS_OPTIONS: ReadonlyArray<{ value: TokenStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "graduating", label: "Graduating" },
  { value: "graduated", label: "Graduated" },
];

const TOKEN_PATH_REGEX = /^\/token\/([^/?#]+)/;

function tokenAddressFromPath(pathname: string): string | undefined {
  const match = TOKEN_PATH_REGEX.exec(pathname);
  return match?.[1];
}

/** Dev-only panel for exercising live-row and token-detail animations. */
export default function DevSimulator() {
  const [open, setOpen] = useState(false);
  const { trades } = useTradeFeed();
  const { data: tokens } = useTokens();
  const location = useLocation();
  const tokenAddress = tokenAddressFromPath(location.pathname);

  // Subscribe only to the routed token's override.
  const override = useSyncExternalStore(
    subscribeTokenOverrides,
    () => getTokenOverride(tokenAddress),
    () => undefined,
  );
  const overrideStatus = override?.status;
  const overrideFill = override?.curveFilledPercent;
  const isGraduatedOverride = overrideStatus === "graduated";

  // Safe unconditionally: `useToken` no-ops until the route has an address.
  const { data: token } = useToken(tokenAddress);
  // Overlay-merged baseline so pump/dump clicks compound from the displayed mcap.
  const { mcapUsd } = useTokenMarketStats(tokenAddress);

  const simulateTrades = (count: number) => {
    if (trades.length === 0) {
      console.warn("[DevSimulator] no trades to template from yet");
      return;
    }
    for (let i = 0; i < count; i++) {
      const template = trades[Math.floor(Math.random() * trades.length)];
      const mock = mutateTrade(template, i);
      // Stagger row flashes instead of stacking one React commit.
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

  /** Inject one routed-token trade and bump the visible curve fill. */
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

  /** Bump mcap upward from the currently displayed value. */
  const pumpMcap = () => {
    if (!tokenAddress) return;
    const base =
      override?.mcapUsd ??
      (mcapUsd && mcapUsd > 0 ? mcapUsd : MCAP_PUMP_COLD_START_USD);
    const factor = 1 + MCAP_PUMP_PCT_MIN + Math.random() * MCAP_PUMP_PCT_RANGE;
    setTokenOverride(tokenAddress, { mcapUsd: base * factor });
  };

  /** Mirror `pumpMcap` for the down-roll animation path. */
  const dumpMcap = () => {
    if (!tokenAddress) return;
    const base =
      override?.mcapUsd ??
      (mcapUsd && mcapUsd > 0 ? mcapUsd : MCAP_PUMP_COLD_START_USD);
    const factor = 1 + MCAP_PUMP_PCT_MIN + Math.random() * MCAP_PUMP_PCT_RANGE;
    setTokenOverride(tokenAddress, {
      mcapUsd: Math.max(MCAP_DUMP_FLOOR_USD, base / factor),
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
              {/* Reset appears only while this token has an override. */}
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
              {/* Curve % is hidden after graduation because the bar is forced to 100%. */}
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
              {/* Routed-token trade controls disappear after graduation. */}
              {!isGraduatedOverride && (
                <div className={styles.row}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={simulateTokenTrade}
                  >
                    +1 trade
                  </button>
                  {/* Mcap bumps exercise the up/down rolling-number branches. */}
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={pumpMcap}
                    title="Bump market cap up by ~6–18% to trigger the roll-up animation"
                  >
                    pump mcap
                  </button>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={dumpMcap}
                    title="Drop market cap by ~6–18% to trigger the roll-down animation"
                  >
                    dump mcap
                  </button>
                </div>
              )}
              {/* Mcap animation remains meaningful after graduation. */}
              {isGraduatedOverride && (
                <div className={styles.row}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={pumpMcap}
                    title="Bump market cap up by ~6–18% to trigger the roll-up animation"
                  >
                    pump mcap
                  </button>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={dumpMcap}
                    title="Drop market cap by ~6–18% to trigger the roll-down animation"
                  >
                    dump mcap
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

/** Synthetic mock address with a `0xdead` sentinel. */
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

/** Clone a real trade with fresh id/timestamp and varied side/amount. */
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
    // Keep tokenName/tokenAddress so row navigation still targets a real detail page.
    tokenName: template.tokenName || `MOCK${i + 1}`,
  };
}

/** Clone a real token so it sorts to the top of the NEW list. */
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
