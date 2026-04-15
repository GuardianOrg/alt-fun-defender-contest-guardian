import { useState } from "react";

import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import BalancesTab from "./BalancesTab";
import styles from "./EarningsPanel.module.css";
import RewardsTab from "./RewardsTab";
import { tokenPath, CREATE_PATH } from "../../app/routes";
import {
  useCreatorEarnings,
  useBalances,
} from "../../hooks/useCreatorEarnings";
import { useWallet } from "../../hooks/useWallet";
import { selectEarningsOpen, setEarningsOpen } from "../../state/uiSlice";
import { cn } from "../../utils/format";
import Button from "../shared/Button";
import ModalOverlay from "../shared/ModalOverlay";

type Tab = "balances" | "rewards";

export default function EarningsPanel() {
  const open = useSelector(selectEarningsOpen);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isConnected, shortAddress, connect } = useWallet();
  const { earnings, claiming, claim } = useCreatorEarnings();
  const { tokens: heldTokens, totalValue } = useBalances();
  const [tab, setTab] = useState<Tab>("balances");

  if (!open) return null;

  const setOpen = (v: boolean) => dispatch(setEarningsOpen(v));

  const goToToken = (addr: string) => {
    setOpen(false);
    navigate(tokenPath(addr));
  };

  return (
    <ModalOverlay
      onClose={() => setOpen(false)}
      ariaLabelledBy="earnings-panel-title"
    >
      <div className={styles.panel}>
        {/* Panel header */}
        <div className={styles.panelHeader}>
          {isConnected ? (
            <div className={styles.avatarWrap}>
              <img src="/avatar.png" alt="" className={styles.avatar} />
              <div>
                <div id="earnings-panel-title" className={styles.addressText}>
                  {shortAddress}
                </div>
                <div className={styles.chainText}>HyperEVM</div>
              </div>
            </div>
          ) : (
            <div id="earnings-panel-title" className={styles.profileLabel}>
              profile
            </div>
          )}
          <button className={styles.escBtn} onClick={() => setOpen(false)}>
            esc
          </button>
        </div>

        {!isConnected ? (
          <div className={styles.notConnected}>
            <div className={styles.emptyIcon}>&#x1F464;</div>
            <div className={styles.textCenter}>
              <div className={styles.emptyTitle}>Connect your wallet</div>
              <div className={styles.emptyText}>
                View your token balances on the curve and claim creator rewards.
              </div>
            </div>
            <Button variant="primary" onClick={connect}>
              Connect Wallet
            </Button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className={styles.tabBar}>
              {(["balances", "rewards"] as const).map((t) => (
                <button
                  key={t}
                  className={cn(
                    styles.tabButton,
                    tab === t && styles.tabButtonActive,
                  )}
                  onClick={() => setTab(t)}
                >
                  {t === "balances" ? "Balances" : "Creator Rewards"}
                  {tab === t && <span className={styles.tabIndicator} />}
                </button>
              ))}
            </div>

            <div className={styles.contentArea}>
              {tab === "balances" ? (
                <BalancesTab
                  tokens={heldTokens}
                  totalValue={totalValue}
                  onTokenClick={goToToken}
                  onLaunch={() => {
                    setOpen(false);
                    navigate(CREATE_PATH);
                  }}
                />
              ) : (
                <RewardsTab
                  earnings={earnings ?? undefined}
                  claiming={claiming}
                  claim={claim}
                  onTokenClick={goToToken}
                  onLaunch={() => {
                    setOpen(false);
                    navigate(CREATE_PATH);
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  );
}
