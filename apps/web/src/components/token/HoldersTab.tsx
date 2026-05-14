import styles from "./BottomTabs.module.css";
import { cn } from "../../utils/format";
import Skeleton from "../shared/Skeleton";

import type { Holder } from "../../services/types";

// Number of placeholder rows to render while `useHolders` is loading the
// first page. Matches the typical visible-row count post-load so the panel
// reads as populated and the table height stays stable.
const HOLDER_SKELETON_COUNT = 8;

interface Props {
  holders: Holder[];
  /** True while `useHolders` is fetching for the first time. */
  isLoading?: boolean;
}

export default function HoldersTab({ holders, isLoading = false }: Props) {
  const maxSupply = Math.max(...holders.map((h) => h.percentSupply), 1);
  const showSkeletons = isLoading && holders.length === 0;

  // Rendered as a real `<table>` (mirroring `TradesTab`) rather than a
  // CSS grid so the columns size to content and the parent `.tabContent`
  // can scroll horizontally on narrow viewports instead of crushing the
  // wallet column. Cells are `white-space: nowrap` so the wallet address
  // and creator pill never wrap onto a second line. Header/cell classes
  // are shared with `TradesTab` to keep the two tabs visually identical.
  return (
    <table
      className={styles.holdersTable}
      aria-busy={showSkeletons ? true : undefined}
    >
      <thead className={styles.holdersHead}>
        <tr className={styles.holdersHeaderRow}>
          <th className={styles.thLeftSmall}>#</th>
          <th className={styles.thLeft}>Wallet</th>
          <th className={styles.thLeftSmall}>Tokens</th>
          <th className={styles.thLeftSmall}>% Supply</th>
          <th className={styles.thLeft}>Bar</th>
        </tr>
      </thead>
      <tbody>
        {showSkeletons
          ? Array.from({ length: HOLDER_SKELETON_COUNT }, (_, i) => (
              <tr
                key={`skeleton-${i}`}
                className={styles.holderTableRow}
                aria-hidden="true"
              >
                <td className={styles.tdRank}>
                  <Skeleton width="1.25rem" height="11px" />
                </td>
                <td className={styles.tdWalletCell}>
                  <Skeleton width="6rem" height="12px" />
                </td>
                <td className={styles.tdTokensCell}>
                  <Skeleton width="4rem" height="12px" />
                </td>
                <td className={styles.tdPercentCell}>
                  <Skeleton width="2.5rem" height="12px" />
                </td>
                <td className={styles.tdBarCell}>
                  <div className={styles.barTrack}>
                    <Skeleton
                      shape="block"
                      width="60%"
                      height="3px"
                      radius="9999px"
                    />
                  </div>
                </td>
              </tr>
            ))
          : holders.map((h) => (
              <tr key={h.rank} className={styles.holderTableRow}>
                <td className={styles.tdRank}>{h.rank}</td>
                <td className={styles.tdWalletCell}>
                  {h.address}
                  {h.isCreator && (
                    <span className={styles.holderCreator}>creator</span>
                  )}
                </td>
                <td className={styles.tdTokensCell}>{h.tokens}</td>
                <td className={styles.tdPercentCell}>{h.percentSupply}%</td>
                <td className={styles.tdBarCell}>
                  <div className={styles.barTrack}>
                    <div
                      className={cn(styles.barFill, "bar-glow-mint")}
                      style={{
                        width: `${(h.percentSupply / maxSupply) * 100}%`,
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
      </tbody>
    </table>
  );
}
