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
import Button from "../shared/Button";
import Chip from "../shared/Chip";
import Modal from "../shared/Modal";
import SegmentedButton from "../shared/SegmentedButton";

type Tab = "balances" | "rewards";

export default function EarningsPanel() {
  const open = useSelector(selectEarningsOpen);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { address, isConnected, shortAddress, connect, disconnect } =
    useWallet();
  const { earnings, claiming, claim, isLoading: earningsLoading } =
    useCreatorEarnings();
  const { tokens: heldTokens, totalValue, isLoading: balancesLoading } =
    useBalances();
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
    <Modal
      onClose={() => setOpen(false)}
      ariaLabelledBy="earnings-panel-title"
      panelClassName={styles.panel}
    >
      <div className={styles.panelHeader}>
        {isConnected ? (
          <div className={styles.avatarWrap}>
            <div>
              <Chip
                success={copied}
                onClick={() => address && copy(address)}
                title={copied ? "Copied!" : "Copy full address"}
                aria-label={
                  copied ? "Address copied" : "Copy full wallet address"
                }
              >
                <span id="earnings-panel-title" className={styles.addressText}>
                  {shortAddress}
                </span>
                {copied ? (
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </Chip>
              <div className={styles.chainRow}>
                <span className={styles.chainText}>HyperEVM</span>
                <span className={styles.chainSep} aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  className={styles.disconnectLink}
                  onClick={handleDisconnect}
                  title="Disconnect wallet"
                >
                  disconnect
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            id="earnings-panel-title"
            className={`${styles.profileLabel} ui-subheading`}
          >
            profile
          </div>
        )}
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
          <div className={styles.tabBar}>
            {(["balances", "rewards"] as const).map((t) => (
              <SegmentedButton
                key={t}
                tone="mint"
                active={tab === t}
                onClick={() => setTab(t)}
              >
                {t === "balances" ? "Balances" : "Creator Rewards"}
              </SegmentedButton>
            ))}
          </div>

          <div className={styles.contentArea}>
            {tab === "balances" ? (
              <BalancesTab
                tokens={heldTokens}
                totalValue={totalValue}
                isLoading={balancesLoading}
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
                isLoading={earningsLoading}
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
    </Modal>
  );
}
