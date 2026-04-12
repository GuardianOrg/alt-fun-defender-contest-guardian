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
    sparklineMap,
    filtered,
    goToToken,
    close,
  } = useSearchModal();

  if (!open) return null;

  return (
    <ModalOverlay onClose={close}>
      <div className={styles.modal}>
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}>&#x2315;</span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Search tokens, tickers\u2026"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          <span className={styles.escBadge} onClick={close}>
            esc
          </span>
        </div>

        {!filtered ? (
          <div className={styles.defaultContent}>
            <div className={styles.sectionLabel}>TRENDING</div>
            <div className={styles.trendingRow}>
              {trendingTokens.map((t) => (
                <SearchTrendingCard
                  key={t.address}
                  token={t}
                  sparklineData={sparklineMap.get(t.address)}
                  onClick={() => goToToken(t.address)}
                />
              ))}
            </div>
            <div className={styles.recentLabel}>RECENTLY VIEWED</div>
            <div className={styles.recentText}>No recently viewed tokens</div>
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
          <SearchResultsList results={filtered} onSelect={goToToken} />
        )}
      </div>
    </ModalOverlay>
  );
}
