import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useNavigate } from "react-router";

import styles from "./RightPanel.module.css";
import { tokenPath } from "../../app/routes";
import { useBalances } from "../../hooks/useBalances";
import { useTokens } from "../../hooks/useTokens";
import { useTradeFeed } from "../../hooks/useTradeFeed";
import { useWallet } from "../../hooks/useWallet";
import {
  cn,
  formatCurveFilled,
  formatPercentOrDash,
  formatTimeAgo,
  formatUsd,
} from "../../utils/format";
import Skeleton from "../shared/Skeleton";

import type { HeldToken } from "../../services/types";

// How many placeholder rows to render while the trade WS hasn't sent
// anything yet. Matches the typical density of the live feed so the panel
// reads as a populated stream rather than an empty card on first paint.
const TRADE_SKELETON_COUNT = 7;
const POSITION_LIMIT = 5;
const SKELETON_ROW_COUNT = 3;

/**
 * Render a single MY-POSITIONS row. Visually mirrors the MARKETS asset rows
 * in `Sidebar` — logo + name/change column + value on the right — so the
 * right panel reads as a balanced peer of the left one. Logo follows the
 * same fallback pattern as `TokenRow` (image → emoji → coin glyph) so a
 * missing or broken image never leaves an empty square.
 */
function PositionRow({
  position,
  onNavigate,
}: {
  position: HeldToken;
  onNavigate: (address: string) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const change = position.change24h;
  const changeUp = change !== null && change >= 0;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNavigate(position.address);
    }
  };

  return (
    <div
      className={styles.positionRow}
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(position.address)}
      onKeyDown={handleKeyDown}
      aria-label={`${position.ticker || position.name} — ${formatUsd(position.valueUsd)} — ${formatPercentOrDash(change)}`}
    >
      <div className={styles.positionLogoWrap}>
        {position.image && !imgError ? (
          <img
            src={position.image}
            alt=""
            className={styles.positionLogo}
            onError={() => setImgError(true)}
          />
        ) : (
          <span className={styles.positionLogoFallback} aria-hidden="true">
            {position.emoji || "🪙"}
          </span>
        )}
      </div>
      <div className={styles.positionMeta}>
        <div className={styles.positionTicker}>
          {position.ticker || position.name}
        </div>
        <div
          className={cn(
            styles.positionChange,
            change === null
              ? styles.positionChangeNeutral
              : changeUp
                ? styles.positionChangeUp
                : styles.positionChangeDown,
          )}
        >
          {formatPercentOrDash(change)}
        </div>
      </div>
      <div className={styles.positionValue}>{formatUsd(position.valueUsd)}</div>
    </div>
  );
}

/**
 * Skeleton placeholder shown while balances are still loading. Mirrors the
 * real row geometry so the panel doesn't reflow when data arrives. Each
 * sub-block animates the shared `shimmer` keyframe (defined in
 * `index.css`).
 */
function PositionSkeleton() {
  return (
    <div className={styles.positionRow} aria-hidden="true">
      <div
        className={cn(styles.positionLogoWrap, styles.skeletonBlock, styles.skeletonCircle)}
      />
      <div className={styles.positionMeta}>
        <div className={cn(styles.skeletonBlock, styles.skeletonLineLg)} />
        <div className={cn(styles.skeletonBlock, styles.skeletonLineSm)} />
      </div>
      <div className={cn(styles.skeletonBlock, styles.skeletonLineValue)} />
    </div>
  );
}

export default function RightPanel() {
  const { trades, isLoading: tradesLoading } = useTradeFeed();
  const { data: tokens } = useTokens();
  const { isConnected } = useWallet();
  const { tokens: heldTokens, isLoading: balancesLoading } = useBalances();
  const navigate = useNavigate();

  const positions = [...heldTokens]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, POSITION_LIMIT);

  const graduating = tokens?.filter((t) => t.status === "graduating") ?? [];
  const handleNavigate = (address: string) => navigate(tokenPath(address));
  // Gate skeletons + `aria-busy` behind the transient loading flag so an
  // empty / disconnected feed surfaces as an empty state once the timeout
  // fires, rather than shimmering forever.
  const showTradeSkeletons = tradesLoading && trades.length === 0;

  return (
    <div className={styles.panel}>
      {/* My positions — moved above recent trades so the user's own holdings
       * are the first thing they see in the right column (issue #584). */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>MY POSITIONS</div>
        {!isConnected ? (
          <div className={styles.emptyRow}>Connect wallet to view</div>
        ) : balancesLoading && positions.length === 0 ? (
          <div aria-busy="true" aria-label="Loading positions">
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <PositionSkeleton key={i} />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className={styles.emptyRow}>No positions yet</div>
        ) : (
          positions.map((p) => (
            <PositionRow key={p.address} position={p} onNavigate={handleNavigate} />
          ))
        )}
      </div>

      {/* Recent trades */}
      <div className={styles.section}>
        <div className={cn(styles.sectionHeader, styles.sectionHeaderLive)}>
          RECENT TRADES
          <span className={styles.liveIndicator}>
            <span className={styles.liveDot} />
            LIVE
          </span>
        </div>
        {/* `aria-live` is intentionally NOT set: this is a high-frequency
         * stream (a new buy/sell every few seconds during active hours)
         * and `polite`/`assertive` would flood screen-reader output with
         * non-actionable noise. The static `aria-label` plus `aria-busy`
         * during the initial load are enough — discrete state changes
         * (e.g. the user's own trade confirming) are announced through
         * the toast system instead. */}
        <div
          aria-label="Recent trades"
          aria-busy={showTradeSkeletons ? true : undefined}
        >
          {showTradeSkeletons ? (
            Array.from({ length: TRADE_SKELETON_COUNT }, (_, i) => (
              <div
                key={i}
                className={cn(styles.tradeRow, styles.tradeSkeletonRow)}
                aria-hidden="true"
              >
                <div className={styles.tradeInfo}>
                  <div className={styles.tradeNameRow}>
                    <Skeleton width="6rem" height="11px" />
                    <Skeleton
                      width="2.5rem"
                      height="10px"
                      className={styles.tradeSkeletonTime}
                    />
                  </div>
                  <Skeleton
                    width="5rem"
                    height="10px"
                    className={styles.tradeSkeletonWallet}
                  />
                </div>
                <Skeleton width="3rem" height="12px" />
              </div>
            ))
          ) : trades.length === 0 ? (
            <div className={styles.emptyRow}>No recent trades yet</div>
          ) : (
            trades.slice(0, TRADE_SKELETON_COUNT).map((t) => {
                const isBuy = t.side === "BUY";
                return (
                  <div
                    key={t.id}
                    className={styles.tradeRow}
                    tabIndex={0}
                    role="button"
                    aria-label={`${isBuy ? "Buy" : "Sell"} ${t.tokenName} — $${Math.round(t.amountUsd).toLocaleString()} — ${t.timestamp}`}
                    onClick={() => navigate(tokenPath(t.tokenAddress))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(tokenPath(t.tokenAddress));
                      }
                    }}
                  >
                    <div className={styles.tradeInfo}>
                      <div className={styles.tradeNameRow}>
                        <span className={styles.tradeName}>{t.tokenName}</span>
                        <span className={styles.tradeTime}>
                          {formatTimeAgo(t.timestamp)}
                        </span>
                      </div>
                      <div className={styles.tradeWallet}>{t.walletAddress}</div>
                    </div>
                    <span
                      className={cn(
                        styles.tradeAmount,
                        isBuy ? styles.tradeAmountBuy : styles.tradeAmountSell,
                      )}
                    >
                      {isBuy ? "+" : "-"}${Math.round(t.amountUsd).toLocaleString()}
                    </span>
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* Graduating soon */}
      {graduating.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>GRADUATING SOON</div>
          {graduating.map((t) => (
            <div
              key={t.address}
              className={cn(styles.infoRow, styles.infoRowNoBorderLast)}
            >
              <span className={styles.infoName}>{t.name}</span>
              <span className={styles.graduatingValue}>
                {formatCurveFilled(t.curveFilled)} · {t.direction === "long" ? "LONG" : "SHORT"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
