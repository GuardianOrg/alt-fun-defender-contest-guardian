import { useState } from "react";

import styles from "./BottomTabs.module.css";
import HoldersTab from "./HoldersTab";
import TradesTab from "./TradesTab";
import { useHolders } from "../../hooks/useHolders";
import { cn } from "../../utils/format";
import ErrorBoundary from "../shared/ErrorBoundary";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

type Tab = "trades" | "holders";

export default function BottomTabs({ token }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("trades");
  // `useHolders` polls `/api/v1/holders/:address` every 5s (issue #452)
  // so the leaderboard tracks balance changes from `Zap` trades and
  // wallet-to-wallet transfers without a page refresh.
  // `placeholderData: []` means `isLoading` flips to false immediately, so
  // we use `isPlaceholderData` to detect the pre-first-response window and
  // render skeleton rows during it.
  const { data: holders = [], isPlaceholderData: holdersLoading } = useHolders(
    token.address,
  );

  return (
    <>
      <div className={styles.tabBar}>
        {(["trades", "holders"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={cn(
              styles.tabBtn,
              activeTab === tab && styles.tabBtnActive,
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {activeTab === tab && <span className={styles.tabIndicator} />}
          </button>
        ))}
      </div>
      <div className={styles.tabContent}>
        {activeTab === "trades" && (
          <ErrorBoundary
            fallback={
              <div className={styles.tabError}>Failed to load trades</div>
            }
          >
            <TradesTab token={token} />
          </ErrorBoundary>
        )}
        {activeTab === "holders" && (
          <ErrorBoundary
            fallback={
              <div className={styles.tabError}>Failed to load holders</div>
            }
          >
            <HoldersTab holders={holders} isLoading={holdersLoading} />
          </ErrorBoundary>
        )}
      </div>
    </>
  );
}
