import { useState } from "react";

import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import BalancesTab from "./BalancesTab";
import styles from "./EarningsPanel.module.css";
import RewardsTab from "./RewardsTab";
import { tokenPath, CREATE_PATH } from "../../app/routes";
import { useBalances } from "../../hooks/useBalances";
import { useCopyState } from "../../hooks/useCopyState";
import { useCreatorEarnings } from "../../hooks/useCreatorEarnings";
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
  const { address, isConnected, shortAddress, connect, disconnect } =
    useWallet();
  const { earnings, claiming, claim } = useCreatorEarnings();
  const { tokens: heldTokens, totalValue } = useBalances();
  const { copied, copy } = useCopyState();
  const [tab, setTab] = useState<Tab>("balances");

  if (!open) return null;

  const setOpen = (v: boolean) => dispatch(setEarningsOpen(v));

  const goToToken = (addr: string) => {
    setOpen(false);
    navigate(tokenPath(addr));
  };

  const handleDisconnect = async () => {
    await disconnect();
    setOpen(false);
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
                <button
                  type="button"
                  className={cn(
                    styles.addressCopyBtn,
                    copied && styles.addressCopyBtnCopied,
                  )}
                  onClick={() => address && copy(address)}
                  title={copied ? "Copied!" : "Copy full address"}
                  aria-label={
                    copied ? "Address copied" : "Copy full wallet address"
                  }
                >
                  <span
                    id="earnings-panel-title"
                    className={styles.addressText}
                  >
                    {shortAddress}
                  </span>
                  <span
                    className={cn(
                      styles.copyIcon,
                      copied
                        ? styles.copyIconCopied
                        : styles.copyIconDefault,
                    )}
                    aria-hidden="true"
                  >
                    {copied ? "✓" : "⎘"}
                  </span>
                </button>
                <div className={styles.chainText}>HyperEVM</div>
              </div>
            </div>
          ) : (
            <div id="earnings-panel-title" className={styles.profileLabel}>
              profile
            </div>
          )}
          <div className={styles.headerActions}>
            {isConnected && (
              <button
                className={styles.disconnectBtn}
                onClick={handleDisconnect}
                title="Disconnect wallet"
                type="button"
              >
                disconnect
              </button>
            )}
            <button className={styles.escBtn} onClick={() => setOpen(false)}>
              esc
            </button>
          </div>
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
