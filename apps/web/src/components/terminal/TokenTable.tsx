import { useEffect, useRef } from "react";

import { useSelector } from "react-redux";

import TokenRow from "./TokenRow";
import TokenRowSkeleton from "./TokenRowSkeleton";
import styles from "./TokenTable.module.css";
import { useFlashOnNew } from "../../hooks/useFlashOnNew";
import { useTokenListLiveFeed } from "../../hooks/useTokenListLiveFeed";
import { useInfiniteTokens } from "../../hooks/useTokens";
import { selectActiveFilter } from "../../state/uiSlice";

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
  const activeFilter = useSelector(selectActiveFilter);
  const { tokens, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteTokens(activeFilter);
  // Keep the row-level mcap / 24h change / progress bar live as trades
  // land on-chain — throttled invalidation of the catalogue +
  // market-data queries off the global `trade` WS channel. See issue
  // #710 and the JSDoc on `useTokenListLiveFeed`.
  useTokenListLiveFeed();

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
  // Once the initial fetch resolves with zero rows we surface a
  // per-tab empty-state line instead of leaving the table area blank
  // (a blank table head reads as "still loading" rather than "no
  // results"). Gated on `!isLoading` so the empty copy never flashes
  // during the first request — the skeleton branch above owns that
  // window — and only when `tokens.length === 0` so it can never
  // overlap with real rows during a background refetch.
  const showEmptyState = !isLoading && tokens.length === 0;

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
            ) : showEmptyState ? (
              <div className={styles.emptyState} role="status">
                {EMPTY_STATE_MESSAGES[activeFilter]}
              </div>
            ) : (
              tokens.map((t) => (
                <TokenRow
                  key={t.address}
                  token={t}
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
