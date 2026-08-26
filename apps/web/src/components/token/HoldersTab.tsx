import { SABLIER_LOCKUP_ADDRESS } from "@launchpad/shared";

import styles from "./BottomTabs.module.css";
import TokenDataTable from "./TokenDataTable";
import { cn } from "../../utils/format";
import { lockClaim } from "../../utils/locks";
import Skeleton from "../shared/Skeleton";

import type { TokenDataTableColumn } from "./TokenDataTable";
import type { ApiTokenLock } from "../../services/api";
import type { Holder } from "../../services/types";

const HOLDER_SKELETON_COUNT = 8;

// Canonical sink addresses users may send tokens to as a burn signal.
const BURN_ADDRESSES: ReadonlySet<string> = new Set([
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000",
  "0xfefefefefefefefefefefefefefefefefefefefe",
]);

// Burn-address signal lives at the tail, so use custom short-forms.
const BURN_DISPLAY_ADDRESS: Record<string, string> = {
  "0x000000000000000000000000000000000000dead": "0x…dead",
  "0x0000000000000000000000000000000000000000": "0x00…00",
  "0xfefefefefefefefefefefefefefefefefefefefe": "0xfe…fe",
};

/**
 * Tag copy for the Sablier escrow row.
 *
 * `LOCKED` is only claimed when the token has a qualifying lock, because the
 * escrow keeps holding the balance after a cliff passes (until the recipient
 * withdraws) and those tokens are freely sellable by then — an unconditional
 * `LOCKED` would be a plain lie in exactly the window that matters.
 *
 * Neither branch says anything about this row's balance. The row aggregates
 * every stream the escrow holds for the token, while `lock` covers only the
 * qualifying deposits, so the two can legitimately differ; reusing the pill's
 * `lockClaim` keeps the unsellable assertion pinned to a stated share of
 * supply rather than to whatever total the row happens to show. The no-lock
 * branch likewise describes the address only — it must stay true while the
 * lock feed is still loading or unavailable, when absence of a lock is
 * unknown rather than established.
 */
function escrowTag(lock: ApiTokenLock | undefined): {
  label: string;
  title: string;
} {
  if (!lock) {
    return {
      label: "SABLIER",
      title:
        "Sablier vesting contract — tokens held here follow a vesting or lock schedule",
    };
  }
  return {
    label: "LOCKED",
    title: lockClaim(lock.lockedPercent, lock.unlocksAt),
  };
}

interface Props {
  holders: Holder[];
  /** True while `useHolders` is fetching for the first time. */
  isLoading?: boolean;
  /** Token creator / contract owner, lowercased for comparison. */
  creatorAddress?: string;
  /** This token's active supply lock, if it has one. */
  lock?: ApiTokenLock;
}

export default function HoldersTab({
  holders,
  isLoading = false,
  creatorAddress,
  lock,
}: Props) {
  const maxSupply = Math.max(...holders.map((h) => h.percentSupply), 1);
  const showSkeletons = isLoading && holders.length === 0;
  const ownerAddress = creatorAddress?.toLowerCase();
  const columns: TokenDataTableColumn[] = [
    { key: "rank", label: "#", variant: "small" },
    { key: "wallet", label: "Wallet" },
    { key: "tokens", label: "Tokens", variant: "small" },
    { key: "percent", label: "% Supply", variant: "small" },
    { key: "bar", label: "Bar" },
  ];

  // Real table layout keeps wallet columns readable on narrow horizontal scroll.
  return (
    <TokenDataTable columns={columns} ariaBusy={showSkeletons}>
        {showSkeletons
          ? Array.from({ length: HOLDER_SKELETON_COUNT }, (_, i) => (
              <tr
                key={`skeleton-${i}`}
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
          : holders.map((h) => {
              const wallet = h.walletFull.toLowerCase();
              const isBurnt = BURN_ADDRESSES.has(wallet);
              const isOwner = !!ownerAddress && wallet === ownerAddress;
              const escrow =
                wallet === SABLIER_LOCKUP_ADDRESS ? escrowTag(lock) : null;
              // Default truncation hides the tail that distinguishes burn sinks.
              const displayAddress = isBurnt
                ? (BURN_DISPLAY_ADDRESS[wallet] ?? h.address)
                : h.address;
              return (
                <tr key={h.rank}>
                  <td className={styles.tdRank}>{h.rank}</td>
                  <td className={styles.tdWalletCell}>
                    <a
                      className={styles.holderAddressLink}
                      href={`https://hyperevmscan.io/address/${h.walletFull}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${h.walletFull} on HyperEVMScan`}
                    >
                      {displayAddress}
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
                    {isBurnt && (
                      <span
                        className={styles.holderTag}
                        title="Tokens sent to the burn address — permanently removed from circulating supply"
                        aria-label="Burnt"
                      >
                        BURN ADDRESS
                      </span>
                    )}
                    {isOwner && (
                      <span
                        className={styles.holderTag}
                        title="Token creator / contract owner"
                        aria-label="Creator"
                      >
                        CREATOR
                      </span>
                    )}
                    {escrow && (
                      <span
                        className={styles.holderTag}
                        title={escrow.title}
                        aria-label={escrow.title}
                      >
                        {escrow.label}
                      </span>
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
              );
            })}
    </TokenDataTable>
  );
}
