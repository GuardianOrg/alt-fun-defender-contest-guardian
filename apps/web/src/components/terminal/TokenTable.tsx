import { useEffect, useMemo, useRef } from "react";

import { useDispatch, useSelector } from "react-redux";

import TokenRow from "./TokenRow";
import TokenRowSkeleton from "./TokenRowSkeleton";
import styles from "./TokenTable.module.css";
import { useFlashOnNew } from "../../hooks/useFlashOnNew";
import { useTokenListLiveFeed } from "../../hooks/useTokenListLiveFeed";
import { useTokenMarketStatsMap } from "../../hooks/useTokenMarketStats";
import { useInfiniteTokens } from "../../hooks/useTokens";
import {
  clearTokenFilters,
  selectActiveFilter,
  selectTokenFilters,
  selectTokenSort,
} from "../../state/uiSlice";

import type { Token, TokenFilter } from "../../services/types";

// Stable accessors for `useFlashOnNew`.
const getTokenId = (t: Token) => t.address.toLowerCase();
const getTokenTimestamp = (t: Token) => t.createdAt;

// Per-tab empty-state copy; keep labels in sync with `CommandBar`.
const EMPTY_STATE_MESSAGES: Record<TokenFilter, string> = {
  trending: "No trending tokens at this time",
  new: "No new tokens at this time",
  graduating: "No tokens graduating at this time",
  graduated: "No graduated tokens yet",
};

function TableHead() {
  return (
    <div className={styles.tableHead}>
      {["ALTCOIN", "UNDERLYING", "24H CHANGE", "PROGRESS", "MCAP"].map((h) => (
        <div key={h} className={styles.headCell}>
          {h}
        </div>
      ))}
    </div>
  );
}

const INITIAL_SKELETON_ROW_COUNT = 8;
const PAGE_SKELETON_ROW_COUNT = 3;
// Eager-load only above-the-fold logos; the rest stay lazy.
const EAGER_ROW_COUNT = 6;

export default function TokenTable() {
  const dispatch = useDispatch();
  const activeFilter = useSelector(selectActiveFilter);
  const tableFilters = useSelector(selectTokenFilters);
  const tokenSort = useSelector(selectTokenSort);
  const hasActiveTableFilters =
    tableFilters.underlying !== undefined ||
    tableFilters.leverage !== undefined ||
    tableFilters.direction !== undefined;
  const { tokens, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteTokens(activeFilter, tableFilters, tokenSort);
  useTokenListLiveFeed();

  // One batched market-data query covers the current infinite-scroll window.
  const addresses = useMemo(() => tokens.map((t) => t.address), [tokens]);
  const { getStats } = useTokenMarketStatsMap(addresses);

  // Timestamp gate filters out initial pages, pagination, and old refetch rows.
  const flashingIds = useFlashOnNew(tokens, getTokenId, {
    getTimestamp: getTokenTimestamp,
  });

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Viewport observer works for both desktop table scrolling and mobile page scrolling.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }
      },
      // Pre-fetch shortly before the user reaches the bottom.
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const showInitialSkeletons = isLoading && tokens.length === 0;
  // After initial load, distinguish "no rows" from "filters too narrow".
  const showEmptyState = !isLoading && tokens.length === 0;
  const showFilteredEmpty = showEmptyState && hasActiveTableFilters;
  const showTabEmpty = showEmptyState && !hasActiveTableFilters;

  return (
    <div className={styles.wrapper}>
      <div className={styles.column}>
        <div className={styles.scrollArea}>
          <div
            className={styles.tableInner}
            aria-busy={showInitialSkeletons || undefined}
          >
            <TableHead />
            {showInitialSkeletons ? (
              Array.from({ length: INITIAL_SKELETON_ROW_COUNT }, (_, i) => (
                <TokenRowSkeleton key={i} />
              ))
            ) : showFilteredEmpty ? (
              <div className={styles.emptyState} role="status">
                <div className={styles.emptyStateTitle}>
                  No tokens match your filters
                </div>
                <div className={styles.emptyStateSubtitle}>
                  Try widening the market, leverage, or direction.
                </div>
                <button
                  type="button"
                  className={styles.emptyStateClear}
                  onClick={() => dispatch(clearTokenFilters())}
                >
                  Clear filters
                </button>
              </div>
            ) : showTabEmpty ? (
              <div className={styles.emptyState} role="status">
                {EMPTY_STATE_MESSAGES[activeFilter]}
              </div>
            ) : (
              tokens.map((t, index) => (
                <TokenRow
                  key={t.address}
                  token={t}
                  stats={getStats(t.address)}
                  isNew={flashingIds.has(getTokenId(t))}
                  eager={index < EAGER_ROW_COUNT}
                />
              ))
            )}
            {hasNextPage && (
              <div ref={sentinelRef} className={styles.sentinel} aria-hidden />
            )}
            {isFetchingNextPage && (
              <div role="status" aria-live="polite" aria-label="Loading more">
                {Array.from({ length: PAGE_SKELETON_ROW_COUNT }, (_, i) => (
                  <TokenRowSkeleton key={`page-skel-${i}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
