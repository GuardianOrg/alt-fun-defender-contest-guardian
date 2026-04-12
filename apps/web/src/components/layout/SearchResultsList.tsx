import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";

import styles from "./SearchModal.module.css";
import { cn } from "../../utils/format";

import type { Token } from "../../services/types";

export default function SearchResultsList({
  results,
  onSelect,
  highlightedIndex,
  onHighlight,
}: {
  results: Token[];
  onSelect: (address: string) => void;
  highlightedIndex: number;
  onHighlight: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-result-index]");
    const target = items[highlightedIndex];
    if (target) {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  return (
    <div className={styles.resultsWrap} ref={listRef}>
      {results.length > 0 ? (
        results.map((t, i) => {
          const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(t.address);
            }
          };
          return (
          <div
            key={t.address}
            data-result-index={i}
            className={cn(
              styles.resultRow,
              i === highlightedIndex && styles.resultRowHighlighted,
            )}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(t.address)}
            onKeyDown={handleKeyDown}
            onMouseEnter={() => onHighlight(i)}
          >
            <div className={styles.resultIcon}>{t.emoji}</div>
            <div>
              <div className={styles.resultName}>{t.name}</div>
              <div className={styles.resultLtName}>{t.ltName}</div>
            </div>
            <div className={styles.resultRight}>
              <div
                className={cn(
                  styles.resultChange,
                  t.change24h >= 0 ? styles.changeUp : styles.changeDown,
                )}
              >
                {t.change24h >= 0 ? "+" : ""}
                {t.change24h}%
              </div>
              <div className={styles.resultMcap}>
                $
                {t.mcapUsd >= 1_000_000
                  ? `${(t.mcapUsd / 1_000_000).toFixed(2)}M`
                  : `${(t.mcapUsd / 1_000).toFixed(1)}K`}
              </div>
            </div>
          </div>
          );
        })
      ) : (
        <div className={styles.noResults}>No tokens found</div>
      )}
    </div>
  );
}
