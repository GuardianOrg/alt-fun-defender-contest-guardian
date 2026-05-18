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
                  <a
                    className={styles.holderAddressLink}
                    href={`https://hyperevmscan.io/address/${h.walletFull}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${h.walletFull} on HyperEVMScan`}
                  >
                    {h.address}
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={styles.externalIcon}
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
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
