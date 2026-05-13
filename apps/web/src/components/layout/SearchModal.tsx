import styles from "./SearchModal.module.css";
import SearchResultsList from "./SearchResultsList";
import SearchTrendingCard from "./SearchTrendingCard";
import SearchTrendingCardSkeleton from "./SearchTrendingCardSkeleton";
import { useSearchModal } from "../../hooks/useSearchModal";
import Modal from "../shared/Modal";

// Count of skeleton trending cards rendered while `useTokens` is in flight.
// Matches `trendingTokens.slice(0, 5)` from `useSearchModal` so the row
// width is identical pre/post-load.
const TRENDING_SKELETON_COUNT = 5;

export default function SearchModal() {
  const {
    open,
    query,
    setQuery,
    inputRef,
    trendingTokens,
    recentlyViewedTokens,
    filtered,
    goToToken,
    close,
    highlightedIndex,
    setHighlightedIndex,
    tokensLoading,
  } = useSearchModal();

  if (!open) return null;

  const recentOffset = trendingTokens.length;

  return (
    <Modal
      onClose={close}
      ariaLabelledBy="search-modal-title"
      align="top"
      panelClassName={styles.modal}
    >
      <h2 id="search-modal-title" className={styles.srOnly}>
        Search tokens
      </h2>
      <div className={styles.searchBar}>
        <svg
          className={styles.searchIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Search tokens, tickers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          aria-label="Search tokens"
        />
      </div>

      {!filtered ? (
        <div className={styles.defaultContent}>
          <div className={styles.sectionLabel}>TRENDING</div>
          <div
            className={styles.trendingRow}
            aria-busy={tokensLoading ? true : undefined}
          >
            {tokensLoading && trendingTokens.length === 0
              ? Array.from({ length: TRENDING_SKELETON_COUNT }, (_, i) => (
                  <SearchTrendingCardSkeleton key={i} />
                ))
              : trendingTokens.map((t, i) => (
                  <SearchTrendingCard
                    key={t.address}
                    token={t}
                    onClick={() => goToToken(t.address)}
                    highlighted={highlightedIndex === i}
                    onMouseEnter={() => setHighlightedIndex(i)}
                  />
                ))}
          </div>
          <div className={styles.recentLabel}>RECENTLY VIEWED</div>
          {recentlyViewedTokens.length === 0 ? (
            <div className={styles.recentText}>No recently viewed tokens</div>
          ) : (
            <div className={styles.trendingRow}>
              {recentlyViewedTokens.map((t, i) => (
                <SearchTrendingCard
                  key={t.address}
                  token={t}
                  onClick={() => goToToken(t.address)}
                  highlighted={highlightedIndex === recentOffset + i}
                  onMouseEnter={() =>
                    setHighlightedIndex(recentOffset + i)
                  }
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <SearchResultsList
          results={filtered}
          onSelect={goToToken}
          highlightedIndex={highlightedIndex}
          onHighlight={setHighlightedIndex}
        />
      )}
    </Modal>
  );
}
