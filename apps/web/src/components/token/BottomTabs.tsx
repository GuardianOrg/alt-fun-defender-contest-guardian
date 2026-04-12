import { useState, useEffect } from "react";

import styles from "./BottomTabs.module.css";
import CommentsTab from "./CommentsTab";
import HoldersTab from "./HoldersTab";
import TradesTab from "./TradesTab";
import { tradeService } from "../../services/tradeService";
import { cn } from "../../utils/format";
import ErrorBoundary from "../shared/ErrorBoundary";

import type { Token, Holder } from "../../services/types";

interface Props {
  token: Token;
}

type Tab = "trades" | "comments" | "holders";

export default function BottomTabs({ token }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("trades");
  const [holders, setHolders] = useState<Holder[]>([]);

  useEffect(() => {
    tradeService.getHolders(token.address).then(setHolders);
  }, [token.address]);

  return (
    <>
      <div className={styles.tabBar}>
        {(["trades", "comments", "holders"] as Tab[]).map((tab) => (
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
        {activeTab === "comments" && (
          <ErrorBoundary
            fallback={
              <div className={styles.tabError}>Failed to load comments</div>
            }
          >
            <CommentsTab token={token} />
          </ErrorBoundary>
        )}
        {activeTab === "holders" && (
          <ErrorBoundary
            fallback={
              <div className={styles.tabError}>Failed to load holders</div>
            }
          >
            <HoldersTab holders={holders} />
          </ErrorBoundary>
        )}
      </div>
    </>
  );
}
