import styles from "./SearchModal.module.css";
import SearchResultsList from "./SearchResultsList";
import SearchTrendingCard from "./SearchTrendingCard";
import { useSearchModal } from "../../hooks/useSearchModal";
import ModalOverlay from "../shared/ModalOverlay";

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
  } = useSearchModal();

  if (!open) return null;

  const recentOffset = trendingTokens.length;

  return (
    <ModalOverlay onClose={close} ariaLabelledBy="search-modal-title">
      <div className={styles.modal}>
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
            id="search-modal-title"
            className={styles.searchInput}
            placeholder="Search tokens, tickers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search tokens"
          />
          <button className={styles.escBadge} onClick={close} aria-label="Close search">
            esc
          </button>
        </div>

        {!filtered ? (
          <div className={styles.defaultContent}>
            <div className={styles.sectionLabel}>TRENDING</div>
            <div className={styles.trendingRow}>
              {trendingTokens.map((t, i) => (
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
            <div className={styles.shortcuts}>
              <span className={styles.shortcutItem}>
                <kbd className={styles.kbd}>&#x21B5;</kbd>
                select
              </span>
              <span className={styles.shortcutItem}>
                <kbd className={styles.kbd}>esc</kbd>
                close
              </span>
            </div>
          </div>
        ) : (
          <SearchResultsList
            results={filtered}
            onSelect={goToToken}
            highlightedIndex={highlightedIndex}
            onHighlight={setHighlightedIndex}
          />
        )}
      </div>
    </ModalOverlay>
  );
}
