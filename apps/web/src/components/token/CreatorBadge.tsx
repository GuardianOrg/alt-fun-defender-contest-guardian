import { useState } from "react";

import styles from "./CreatorBadge.module.css";
import { FEES } from "../../config/constants";
import { useCreatorEarnings } from "../../hooks/useCreatorEarnings";
import { useWallet } from "../../hooks/useWallet";
import { cn } from "../../utils/format";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function CreatorBadge({ token }: Props) {
  const { address } = useWallet();
  const { earnings, claiming, claim } = useCreatorEarnings();
  const [expanded, setExpanded] = useState(false);

  const isCreator =
    !!address && token.creatorAddress.toLowerCase() === address.toLowerCase();
  if (!isCreator) return null;

  const tokenData = earnings?.tokens.find(
    (t) => t.address.toLowerCase() === token.address.toLowerCase(),
  );

  return (
    <div className={styles.wrapper}>
      <button className={styles.header} onClick={() => setExpanded(!expanded)}>
        <div className={styles.headerLeft}>
          <span className={styles.badge}>creator</span>
          <span className={styles.claimable}>
            {tokenData
              ? `$${tokenData.feesClaimableUsd.toFixed(2)} claimable`
              : "Your token"}
          </span>
        </div>
        <span className={styles.chevron}>{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && tokenData && (
        <div className={styles.details}>
          <div className={styles.statsGrid}>
            <div>
              <div className={styles.statLabel}>volume</div>
              <div className={styles.statValue}>
                ${tokenData.totalVolumeUsd.toLocaleString()}
              </div>
            </div>
            <div>
              <div className={styles.statLabel}>earned</div>
              <div className={styles.statValue}>
                ${tokenData.feesEarnedUsd.toFixed(2)}
              </div>
            </div>
            <div>
              <div className={styles.statLabel}>claimable</div>
              <div className={styles.statMint}>
                ${tokenData.feesClaimableUsd.toFixed(2)}
              </div>
            </div>
          </div>

          <button
            className={cn(
              styles.claimBtn,
              tokenData.feesClaimableUsd > 0
                ? styles.claimBtnActive
                : styles.claimBtnDisabled,
              claiming && styles.claimBtnBusy,
            )}
            disabled={tokenData.feesClaimableUsd <= 0 || claiming}
            onClick={() => claim(token.address)}
          >
            {claiming
              ? "Claiming…"
              : tokenData.feesClaimableUsd > 0
                ? `Claim $${tokenData.feesClaimableUsd.toFixed(2)}`
                : "Nothing to claim"}
          </button>

          <div className={styles.hint}>
            You earn {FEES.creatorSplit * 100}% of all volume on this curve. Fees settle in USDC.
          </div>
        </div>
      )}
    </div>
  );
}
