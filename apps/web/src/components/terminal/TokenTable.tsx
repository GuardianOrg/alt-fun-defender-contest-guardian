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
} from "../../state/uiSlice";

import type { Token, TokenFilter } from "../../services/types";

// Stable accessors for `useFlashOnNew` — defined at module scope so
// the hook doesn't see a fresh function identity on every render.
// Token addresses are unique across the catalogue (the contract
// address is the natural key); `createdAt` is an ISO-8601 string the
// API serves on every `/tokens` row and is what gates the live-vs-
// historical decision inside the hook (see its JSDoc).
const getTokenId = (t: Token) => t.address.toLowerCase();
const getTokenTimestamp = (t: Token) => t.createdAt;

// Per-tab copy for the "no rows" state. Sits next to the tab list in
// `CommandBar` conceptually — keep both in sync if a new filter
// lands. Phrasing intentionally matches the tab label so a user
// scanning the screen reads "GRADUATING" then "No tokens graduating
// at this time" without translation.
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

// Render enough placeholder rows to fill the table viewport while the
// initial `/api/v1/tokens` request is in flight. Picked to match the
// typical row density users see post-load — too few leaves the panel
// empty-looking, too many causes visible reflow when real rows replace
// them.
const INITIAL_SKELETON_ROW_COUNT = 8;
// Fewer placeholders for subsequent pages — the user is already past
// the initial fold, so a short shimmer block is enough to signal "more
// inbound" without dominating the scroll position.
const PAGE_SKELETON_ROW_COUNT = 3;

export default function TokenTable() {
  const dispatch = useDispatch();
  const activeFilter = useSelector(selectActiveFilter);
  const tableFilters = useSelector(selectTokenFilters);
  const hasActiveTableFilters =
    tableFilters.underlying !== undefined ||
    tableFilters.leverage !== undefined ||
    tableFilters.direction !== undefined;
  const { tokens, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteTokens(activeFilter, tableFilters);
  // Keep the row-level mcap / 24h change / progress bar live as trades
  // land on-chain — throttled invalidation of the catalogue +
  // market-data queries off the global `trade` WS channel. See issue
  // #710 and the JSDoc on `useTokenListLiveFeed`.
  useTokenListLiveFeed();

  // Lift the per-page market-data fetch to the table parent so child
  // rows don't each spawn their own React Query subscription. One
  // bounded `POST /market-data { addresses }` covers every row in the
  // current infinite-scroll window; `useTokenMarketStatsMap`
  // normalises + dedupes the address list internally so the cache key
  // is stable across renders. `useMemo` keeps the array identity
  // stable when `tokens` content is unchanged so the underlying query
  // doesn't refetch on every parent re-render.
  const addresses = useMemo(
    () => tokens.map((t) => t.address),
    [tokens],
  );
  const { getStats } = useTokenMarketStatsMap(addresses);

  // Highlight newly arrived tokens for ~2s on every tab. The earlier
  // version gated this with `enabled: activeFilter === "new"` on the
  // theory that a fresh arrival only "legitimately lands at the top"
  // on NEW — on TRENDING / TOP a brand-new token usually drops in deep
  // or not at all, so a flash near the top of those lists could read
  // as noise. We've decided that's a worthwhile trade for the consistent
  // "this row is live" signal across tabs, and the hook's internal
  // timestamp gate is enough on its own: it still filters out the
  // initial page, scrolled-in pagination, and any older row that
  // resurfaces in a refetch, so only tokens whose `createdAt` post-
  // dates the moment the user opened the table can ever flash —
  // regardless of which tab they're viewing.
  const flashingIds = useFlashOnNew(tokens, getTokenId, {
    getTimestamp: getTokenTimestamp,
  });

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver against the viewport handles both layouts —
  // on desktop the `.scrollArea` overflow clips the sentinel out of the
  // viewport until the user scrolls down; on mobile the table overflows
  // visibly and the page scroll moves the sentinel in. Either way,
  // "sentinel enters viewport" maps cleanly to "load the next page".
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
      // 200px rootMargin pre-fetches one viewport before the user hits
      // the bottom — the next page is usually ready by the time the
      // last visible row scrolls into view.
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // The initial fetch is the only window where we have zero rows to show.
  // `useInfiniteTokens.isLoading` is true exactly during that first
  // request (TanStack Query semantics); once any page lands it flips
  // off and `tokens.length` carries the catalogue. After that, the
  // sentinel + "Loading more…" indicator handle pagination feedback.
  const showInitialSkeletons = isLoading && tokens.length === 0;
  // Once the initial fetch resolves with zero rows we surface an
  // empty-state line instead of leaving the table area blank (a blank
  // table head reads as "still loading" rather than "no results").
  // Two flavours: with active facet filters, we show a "clear filters"
  // affordance so the user can recover from an over-narrow query;
  // without facets, we show the per-tab phrasing keyed off
  // `activeFilter`. Both branches are gated on `!isLoading` so the
  // empty copy never flashes during the first request — the skeleton
  // branch above owns that window — and only when `tokens.length === 0`
  // so they can never overlap with real rows during a background
  // refetch.
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
              tokens.map((t) => (
                <TokenRow
                  key={t.address}
                  token={t}
                  stats={getStats(t.address)}
                  isNew={flashingIds.has(getTokenId(t))}
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
