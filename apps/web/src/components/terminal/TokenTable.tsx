import { useEffect, useRef } from "react";

import { useSelector } from "react-redux";

import TokenRow from "./TokenRow";
import styles from "./TokenTable.module.css";
import { useInfiniteTokens } from "../../hooks/useTokens";
import { selectActiveFilter } from "../../state/uiSlice";

function TableHead() {
  return (
    <div className={styles.tableHead}>
      {[
        "ALTCOIN",
        "UNDERLYING",
        "DIRECTION / LEVERAGE",
        "24H CHANGE",
        "PROGRESS",
        "MCAP",
      ].map((h) => (
        <div key={h} className={styles.headCell}>
          {h}
        </div>
      ))}
    </div>
  );
}

export default function TokenTable() {
  const activeFilter = useSelector(selectActiveFilter);
  const { tokens, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteTokens(activeFilter);

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

  return (
    <div className={styles.wrapper}>
      <div className={styles.column}>
        <div className={styles.scrollArea}>
          <div className={styles.tableInner}>
            <TableHead />
            {tokens.map((t) => (
              <TokenRow key={t.address} token={t} />
            ))}
            {hasNextPage && (
              <div ref={sentinelRef} className={styles.sentinel} aria-hidden />
            )}
            {isFetchingNextPage && (
              <div
                className={styles.loadingRow}
                role="status"
                aria-live="polite"
              >
                Loading more…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
