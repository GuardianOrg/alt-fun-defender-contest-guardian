import styles from "./SearchModal.module.css";
import { cn } from "../../utils/format";

import type { Token } from "../../services/types";

export default function SearchResultsList({
  results,
  onSelect,
}: {
  results: Token[];
  onSelect: (address: string) => void;
}) {
  return (
    <div className={styles.resultsWrap}>
      {results.length > 0 ? (
        results.map((t) => (
          <div
            key={t.address}
            className={styles.resultRow}
            onClick={() => onSelect(t.address)}
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
        ))
      ) : (
        <div className={styles.noResults}>No tokens found</div>
      )}
    </div>
  );
}
