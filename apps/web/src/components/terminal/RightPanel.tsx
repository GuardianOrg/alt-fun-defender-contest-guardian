import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useNavigate } from "react-router";

import styles from "./RightPanel.module.css";
import { tokenPath } from "../../app/routes";
import { useBalances } from "../../hooks/useBalances";
import { useFlashOnNew } from "../../hooks/useFlashOnNew";
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
import CopyAddressButton from "../shared/CopyAddressButton";
import Skeleton from "../shared/Skeleton";

import type { HeldToken, Trade } from "../../services/types";

const getTradeId = (t: Trade) => t.id;
// `Trade.timestamp` is an ISO-8601 string set from the on-chain
// trade's block timestamp — the hook's live-arrival gate compares
// it against the hook's mount time so REST-poll history (initial
// 50 rows pulled at mount, all minutes/hours old) never flashes,
// while a fresh WS broadcast lands on the right side of the gate.
const getTradeTimestamp = (t: Trade) => t.timestamp;

// How many placeholder rows to render while the trade WS hasn't sent
// anything yet. The trades section now fills the rest of the right
// column (positions is capped at 50% of the available height), so we
// surface more skeleton rows than fit on a typical viewport — extras get
// hidden behind the section's internal scroll until real trades arrive.
const TRADE_SKELETON_COUNT = 12;
// Skeleton rows shown beneath an in-flight `loadMore` request. Smaller
// than the initial-load count because the user is already past the
// initial fold — the goal is just to signal "more inbound" without
// dominating the bottom of the visible feed.
const PAGE_SKELETON_ROW_COUNT = 3;
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
        className={cn(
          styles.positionLogoWrap,
          styles.skeletonBlock,
          styles.skeletonCircle,
        )}
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
  const {
    trades,
    isLoading: tradesLoading,
    isFetchingMore,
    hasMore,
    loadMore,
  } = useTradeFeed();
  const { data: tokens } = useTokens();
  const { isConnected } = useWallet();
  const { tokens: heldTokens, isLoading: balancesLoading } = useBalances();
  const navigate = useNavigate();
  const tradesScrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Newly arrived trades flash a buy/sell-tinted background that
  // fades to transparent over ~2s. The hook's timestamp gate compares
  // each trade's on-chain timestamp to the hook's mount time, so the
  // initial REST-poll batch (every row is from before the user
  // opened the page) is silently retired into "seen" and only
  // genuinely-live WS broadcasts trigger the animation.
  const flashingTradeIds = useFlashOnNew(trades, getTradeId, {
    getTimestamp: getTradeTimestamp,
  });

  const positions = [...heldTokens]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, POSITION_LIMIT);

  const graduating = tokens?.filter((t) => t.status === "graduating") ?? [];
  const handleNavigate = (address: string) => navigate(tokenPath(address));
  // Gate skeletons + `aria-busy` behind the transient loading flag so an
  // empty / disconnected feed surfaces as an empty state once the timeout
  // fires, rather than shimmering forever.
  const showTradeSkeletons = tradesLoading && trades.length === 0;

  // Wire infinite scroll to the inner trades scroller (issue #807). The
  // section body owns its own overflow (`.sectionBody`), so the
  // observer's root MUST be that element — falling back to the viewport
  // would never fire because the right column itself doesn't scroll.
  // 200px rootMargin pre-fetches one viewport before the user hits the
  // bottom, mirroring `TokenTable`'s pagination cadence.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = tradesScrollRef.current;
    if (!sentinel || !root) return;
    if (!hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore && !isFetchingMore) {
            loadMore();
          }
        }
      },
      { root, rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isFetchingMore, loadMore]);

  return (
    <div className={styles.panel}>
      {/* MY POSITIONS and RECENT TRADES jointly fill the column's height:
       * positions is capped at 50% of the available space (scrolling
       * internally when the user has many positions), and trades takes
       * the remaining space (`flex: 1`) with its own internal scroll.
       * Net effect: when both lists are dense the split lands at 50/50;
       * when positions is short, trades expands to absorb the slack
       * instead of leaving an empty band below it.
       *
       * Positions also moved above recent trades so the user's own
       * holdings are the first thing they see in the right column. */}
      <div className={cn(styles.section, styles.sectionPositions)}>
        <div className={styles.sectionHeader}>MY POSITIONS</div>
        <div className={styles.sectionBody}>
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
              <PositionRow
                key={p.address}
                position={p}
                onNavigate={handleNavigate}
              />
            ))
          )}
        </div>
      </div>

      <div className={cn(styles.section, styles.sectionTrades)}>
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
          ref={tradesScrollRef}
          className={styles.sectionBody}
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
            trades.map((t) => {
              const isBuy = t.side === "BUY";
              const flashing = flashingTradeIds.has(t.id);
              return (
                <div
                  key={t.id}
                  className={cn(styles.tradeRow, flashing && styles.flash)}
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
                    <div className={styles.tradeWalletRow}>
                      <span className={styles.tradeWallet}>
                        {t.walletAddress}
                      </span>
                      <CopyAddressButton
                        address={t.walletAddressFull}
                        className={styles.tradeCopyBtn}
                      />
                    </div>
                  </div>
                  <span
                    className={cn(
                      styles.tradeAmount,
                      isBuy ? styles.tradeAmountBuy : styles.tradeAmountSell,
                    )}
                  >
                    {isBuy ? "+" : "-"}$
                    {Math.round(t.amountUsd).toLocaleString()}
                  </span>
                </div>
              );
            })
          )}
          {/* Sentinel + page-skeletons sit OUTSIDE the data conditional so
           * the sentinel is in the DOM from first mount (issue #841).
           * Previously it lived inside the `trades.length > 0` branch,
           * which meant on initial render — when `showTradeSkeletons`
           * was true — the sentinel didn't exist yet, the
           * `IntersectionObserver` effect bailed (`sentinel === null`),
           * and the effect's deps (`hasMore`, `isFetchingMore`, stable
           * `loadMore`) never re-fired to re-attach once trades arrived.
           * Net effect: pagination silently dead. Mirrors the structure
           * `TokenTable` uses. `loadMore` itself guards against a fire
           * with zero loaded trades, so an observer trigger during the
           * brief skeleton window (sentinel above the fold) is a no-op
           * rather than a redundant page-zero refetch. */}
          {hasMore && (
            <div
              ref={sentinelRef}
              className={styles.sentinel}
              aria-hidden="true"
            />
          )}
          {isFetchingMore && (
            <div role="status" aria-live="polite" aria-label="Loading more trades">
              {Array.from({ length: PAGE_SKELETON_ROW_COUNT }, (_, i) => (
                <div
                  key={`page-skel-${i}`}
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
              ))}
            </div>
          )}
        </div>
      </div>

      {graduating.length > 0 && (
        <div className={cn(styles.section, styles.sectionGraduating)}>
          <div className={styles.sectionHeader}>GRADUATING SOON</div>
          {graduating.map((t) => (
            <div
              key={t.address}
              className={cn(styles.infoRow, styles.infoRowNoBorderLast)}
            >
              <span className={styles.infoName}>{t.name}</span>
              <span className={styles.graduatingValue}>
                {formatCurveFilled(t.curveFilled)} ·{" "}
                {t.direction === "long" ? "LONG" : "SHORT"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
