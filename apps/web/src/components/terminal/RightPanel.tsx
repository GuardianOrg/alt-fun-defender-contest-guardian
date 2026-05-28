import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useNavigate } from "react-router";

import styles from "./RightPanel.module.css";
import TerminalSection from "./TerminalSection";
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
import { srcSetFor, transformImageUrl } from "../../utils/image";
import CopyAddressButton from "../shared/CopyAddressButton";
import Skeleton from "../shared/Skeleton";

import type { HeldToken, Trade } from "../../services/types";

const getTradeId = (t: Trade) => t.id;
// Lets the flash hook ignore initial REST history and animate only live arrivals.
const getTradeTimestamp = (t: Trade) => t.timestamp;

const TRADE_SKELETON_COUNT = 12;
const PAGE_SKELETON_ROW_COUNT = 3;
const SKELETON_ROW_COUNT = 3;
// Keep the non-scrolling "graduating soon" section from crowding positions/trades.
const GRADUATING_SOON_LIMIT = 5;

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
            src={transformImageUrl(position.image, { width: 32 })}
            srcSet={srcSetFor(position.image, 32) || undefined}
            alt=""
            width={32}
            height={32}
            className={styles.positionLogo}
            onError={() => setImgError(true)}
            loading="lazy"
            decoding="async"
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
  // API status=graduating means "near graduation", not only the short frozen lifecycle window.
  const { data: graduatingTokens } = useTokens("graduating");
  const { isConnected } = useWallet();
  const { tokens: heldTokens, isLoading: balancesLoading } = useBalances();
  const navigate = useNavigate();
  const tradesScrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const flashingTradeIds = useFlashOnNew(trades, getTradeId, {
    getTimestamp: getTradeTimestamp,
  });

  const positions = [...heldTokens].sort((a, b) => b.valueUsd - a.valueUsd);

  // Slice after the API's curve-filled sort so the closest tokens stay first.
  const graduating = graduatingTokens?.slice(0, GRADUATING_SOON_LIMIT) ?? [];
  const handleNavigate = (address: string) => navigate(tokenPath(address));
  const showTradeSkeletons = tradesLoading && trades.length === 0;

  // Observe inside the trades scroller, not the viewport; the right column itself does not scroll.
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
      <TerminalSection
        title="MY POSITIONS"
        className={styles.sectionPositions}
        fade="overflow"
      >
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
      </TerminalSection>

      <TerminalSection
        title="RECENT TRADES"
        className={styles.sectionTrades}
        fade="always"
        bodyRef={tradesScrollRef}
        bodyProps={{
          "aria-label": "Recent trades",
          "aria-busy": showTradeSkeletons ? true : undefined,
        }}
      >
        {/* No aria-live: this high-frequency feed would flood screen readers. */}
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
                  {isBuy ? "+" : "-"}${Math.round(t.amountUsd).toLocaleString()}
                </span>
              </div>
            );
          })
        )}
        {/* Keep the sentinel mounted during skeleton state so pagination attaches on first render. */}
        {hasMore && (
          <div
            ref={sentinelRef}
            className={styles.sentinel}
            aria-hidden="true"
          />
        )}
        {isFetchingMore && (
          <div
            role="status"
            aria-live="polite"
            aria-label="Loading more trades"
          >
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
      </TerminalSection>

      {graduating.length > 0 && (
        <TerminalSection
          title="GRADUATING SOON"
          className={styles.sectionGraduating}
        >
          {graduating.map((t) => (
            <div
              key={t.address}
              className={styles.infoRow}
              role="button"
              tabIndex={0}
              onClick={() => handleNavigate(t.address)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNavigate(t.address);
                }
              }}
              aria-label={`${t.ticker || t.name} — ${formatCurveFilled(t.curveFilled)} graduating`}
            >
              <span className={styles.infoName}>{t.ticker || t.name}</span>
              <span className={styles.graduatingValue}>
                {formatCurveFilled(t.curveFilled)}
              </span>
            </div>
          ))}
        </TerminalSection>
      )}
    </div>
  );
}
