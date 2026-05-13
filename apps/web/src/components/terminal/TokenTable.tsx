import { useEffect, useRef } from "react";

import { useSelector } from "react-redux";

import TokenRow from "./TokenRow";
import TokenRowSkeleton from "./TokenRowSkeleton";
import styles from "./TokenTable.module.css";
import { useTokenListLiveFeed } from "../../hooks/useTokenListLiveFeed";
import { useInfiniteTokens } from "../../hooks/useTokens";
import { selectActiveFilter } from "../../state/uiSlice";

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
  const activeFilter = useSelector(selectActiveFilter);
  const {
    tokens,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteTokens(activeFilter);
  // Keep the row-level mcap / 24h change / progress bar live as trades
  // land on-chain — throttled invalidation of the catalogue +
  // market-data queries off the global `trade` WS channel. See issue
  // #710 and the JSDoc on `useTokenListLiveFeed`.
  useTokenListLiveFeed();

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

  return (
    <div className={styles.wrapper}>
      <div className={styles.column}>
        <div className={styles.scrollArea}>
          <div
            className={styles.tableInner}
            aria-busy={showInitialSkeletons || undefined}
          >
            <TableHead />
            {showInitialSkeletons
              ? Array.from(
                  { length: INITIAL_SKELETON_ROW_COUNT },
                  (_, i) => <TokenRowSkeleton key={i} />,
                )
              : tokens.map((t) => <TokenRow key={t.address} token={t} />)}
            {hasNextPage && (
              <div ref={sentinelRef} className={styles.sentinel} aria-hidden />
            )}
            {isFetchingNextPage && (
              <div role="status" aria-live="polite" aria-label="Loading more">
                {Array.from(
                  { length: PAGE_SKELETON_ROW_COUNT },
                  (_, i) => (
                    <TokenRowSkeleton key={`page-skel-${i}`} />
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
