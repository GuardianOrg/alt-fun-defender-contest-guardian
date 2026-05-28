import { useState } from "react";

import styles from "./CreatorBadge.module.css";
import { CREATOR_FEE_SHARE_PCT } from "../../config/constants";
import { useCreatorEarnings } from "../../hooks/useCreatorEarnings";
import { useWallet } from "../../hooks/useWallet";
import { formatUsd } from "../../utils/format";
import Button from "../shared/Button";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function CreatorBadge({ token }: Props) {
  const { address } = useWallet();
  const { earnings, claiming, claim } = useCreatorEarnings();
  const [expanded, setExpanded] = useState(true);

  const isCreator =
    !!address && token.creatorAddress.toLowerCase() === address.toLowerCase();
  if (!isCreator) return null;

  const tokenData = earnings?.tokens.find(
    (t) => t.address.toLowerCase() === token.address.toLowerCase(),
  );
  // Claimable is pooled across every token the creator has launched — the
  // vault exposes a single balance, not per-token splits. The badge shows
  // the pooled figure so the claim button reflects exactly what a click will
  // pay out.
  const totalClaimableUsd = earnings?.totalClaimable ?? 0;

  return (
    <div className={styles.wrapper}>
      <button className={styles.header} onClick={() => setExpanded(!expanded)}>
        <div className={styles.headerLeft}>
          <span className={styles.badge}>creator</span>
        </div>
        <span className={styles.chevron}>{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && earnings && (
        <div className={styles.details}>
          {/*
            Per-token stats are conditional on `tokenData` because the
            creator service paginates `/api/v1/tokens?creator=…` to gather
            per-token volume / earned, and that walk can transiently fail
            (or be in flight) while the user is already on the page. The
            pooled claim action, by contrast, reads `earnings.totalClaimable`
            straight off `FeeVault.creatorBalance(wallet)` — so we still
            want to show the claim button even when the per-token slice
            isn't in hand yet (otherwise the header would promise a
            claimable balance that the user has no way to action from
            this page).
          */}
          {tokenData && (
            <div className={styles.statsGrid}>
              <div>
                <div className={`${styles.statLabel} ui-subheading`}>
                  volume
                </div>
                <div className={styles.statValue}>
                  {formatUsd(tokenData.totalVolumeUsd)}
                </div>
              </div>
              <div>
                <div className={`${styles.statLabel} ui-subheading`}>
                  earned
                </div>
                <div className={styles.statValue}>
                  ${tokenData.feesEarnedUsd.toFixed(2)}
                </div>
              </div>
              <div>
                <div className={`${styles.statLabel} ui-subheading`}>
                  claimable
                </div>
                <div className={styles.statMint}>
                  ${totalClaimableUsd.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          <Button
            variant="primary"
            fullWidth
            busy={claiming}
            disabled={totalClaimableUsd <= 0}
            onClick={() => claim()}
          >
            {claiming
              ? "Claiming…"
              : totalClaimableUsd > 0
                ? `Claim $${totalClaimableUsd.toFixed(2)}`
                : "Nothing to claim"}
          </Button>

          <div className={styles.hint}>
            You earn {CREATOR_FEE_SHARE_PCT}% of all trading fees. Fees accrue
            in USDC and can be claimed anytime.
          </div>
        </div>
      )}
    </div>
  );
}
