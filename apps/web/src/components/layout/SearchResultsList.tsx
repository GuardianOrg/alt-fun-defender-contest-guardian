import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";

import styles from "./SearchModal.module.css";
import { useTokenMarketStatsMap } from "../../hooks/useTokenMarketStats";
import {
  cn,
  formatMcapUsdOrDash,
  formatPercentOrDash,
} from "../../utils/format";
import { tierFor } from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";

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
  const { getStats } = useTokenMarketStatsMap();

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
          const stats = getStats(t.address);
          const up = (stats.change24h ?? 0) >= 0;
          const vanityTier = tierFor(t.address);
          const row = (
            <div
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
                    up ? styles.changeUp : styles.changeDown,
                  )}
                >
                  {formatPercentOrDash(stats.change24h)}
                </div>
                <div className={styles.resultMcap}>
                  {formatMcapUsdOrDash(stats.mcapUsd)}
                </div>
              </div>
            </div>
          );
          if (vanityTier.id === "none") return row;
          return (
            <VanityEffect
              key={t.address}
              tier={vanityTier}
              size="row"
              as="block"
            >
              {row}
            </VanityEffect>
          );
        })
      ) : (
        <div className={styles.noResults}>No tokens found</div>
      )}
    </div>
  );
}
