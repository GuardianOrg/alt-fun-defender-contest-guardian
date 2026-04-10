import { useState } from "react";

import styles from "./ReferralBanner.module.css";
import { CloseIcon } from "../../../assets/CloseIcon";
import { useReferralsData } from "../../../hooks/Indexer/useReferrals";
import { useTheme } from "../../../hooks/useTheme";
import useJoinWithReferral from "../../../web3/writes/referrals/useJoinWithReferral";
import Button from "../Buttons/Button";

const ReferralBanner = () => {
  const { joinWithReferral } = useJoinWithReferral();
  const { isJoined } = useReferralsData();
  const { theme } = useTheme();

  const [isDismissed, setIsDismissed] = useState(false);
  const referralCode = localStorage.getItem("referral_code");

  if (
    isJoined ||
    isJoined === null ||
    !referralCode ||
    isDismissed === null ||
    isDismissed === true
  )
    return null;

  return (
    <div className={styles.banner}>
      <div className={styles.bannerText}>
        You’ve been referred! Claim with code <span>{referralCode}</span> to
        receive trading rebates.
      </div>
      <div className={styles.bannerActions}>
        <div className={styles.buttonContainer}>
          <Button
            variant="info-blue-outlined"
            size="small"
            onClick={() => joinWithReferral(referralCode)}
            wide
          >
            Claim code
          </Button>
        </div>
        <button
          className={styles.closeIcon}
          type="button"
          aria-label="Close"
          onClick={() => {
            setIsDismissed(true);
          }}
        >
          <CloseIcon color={theme === "dark" ? "#fff" : "#1976D2"} />
        </button>
      </div>
    </div>
  );
};

export default ReferralBanner;
