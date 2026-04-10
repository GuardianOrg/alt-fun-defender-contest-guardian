import React, { useRef, useState } from "react";

import CountUp from "react-countup";

import styles from "./ReferralCard.module.css";
import { Copy } from "../../../../assets/Copy";
import usdc from "../../../../assets/logos/usdc.svg";
import { People } from "../../../../assets/People";
import { Tick } from "../../../../assets/Tick";
import { useGlobalStorageData } from "../../../../hooks/Indexer/useGlobalStorage";
import { useReferralsData } from "../../../../hooks/Indexer/useReferrals";
import { bigIntToNumber } from "../../../../utils/bigIntToNumber.util";
import { formatNumber } from "../../../../utils/formatNumber.util";
import useClaimRebates from "../../../../web3/writes/referrals/useClaimRebates";
import Button from "../../../Global/Buttons/Button";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";

const ReferralCard = () => {
  const globalStorageData = useGlobalStorageData();
  const { claimRebates } = useClaimRebates();
  const {
    referrerCode,
    referralCode,
    referredUserCount,
    claimedRebates,
    claimableRebates,
  } = useReferralsData();

  const [copiedOwnCode, setCopiedOwnCode] = useState(false);
  const [copiedReferrersCode, setCopiedReferrersCode] = useState(false);

  const prevTotalRebateRef = useRef(0);

  const tooltipCopy = () => {
    if (referrerCode && !referralCode) {
      return `You are receiving ${
        bigIntToNumber(globalStorageData.referrerRebate, 18) * 100
      }% of fees from users you have referred.`;
    } else if (!referrerCode && referralCode) {
      return `You are receiving ${
        bigIntToNumber(globalStorageData.refereeRebate, 18) * 100
      }% rebate on fees.`;
    } else if (referrerCode && referralCode) {
      return `You are receiving ${
        bigIntToNumber(globalStorageData.referrerRebate, 18) * 100
      }% of fees from users you referred, plus ${
        bigIntToNumber(globalStorageData.refereeRebate, 18) * 100
      }% rebate on your own fees.`;
    } else {
      return "";
    }
  };

  const referralCodeUrl = `https://bounce.tech/register?ref=${referralCode}`;
  const referrerCodeUrl = `https://bounce.tech/register?ref=${referrerCode}`;

  if ((!referralCode && !referrerCode) || !globalStorageData) return null;

  return (
    <div className={styles.card}>
      <h3>Referral Program</h3>
      <div className={styles.referralStatCardsContainer}>
        {referralCode && (
          <div className={styles.referralStatCard}>
            <h4 className={styles.cardTitle}>
              Your referral link
              <InfoTooltip
                content={`Share your referral link to get ${
                  bigIntToNumber(globalStorageData.referrerRebate, 18) * 100
                }% in fee rewards from users who use your code.`}
              />
            </h4>
            <span className={styles.referralCode}>
              {referralCode}
              <div
                className={styles.copyIcon}
                onClick={() => {
                  navigator.clipboard.writeText(referralCodeUrl);
                  setCopiedOwnCode(true);
                  setTimeout(() => setCopiedOwnCode(false), 1200);
                }}
              >
                {copiedOwnCode ? (
                  <Tick color="var(--primary-500-or-white)" size={14} />
                ) : (
                  <Copy color="var(--primary-500-or-white)" size={14} />
                )}
              </div>
            </span>
            <span className={styles.referredBy}>
              <People color="var(--grey-500-or-white)" />
              You've referred {referredUserCount} users
            </span>
          </div>
        )}
        {referrerCode && (
          <div className={styles.referralStatCard}>
            <h4 className={styles.cardTitle}>Referred by</h4>
            <span className={styles.referralCode}>
              {referrerCode}
              <div
                className={styles.copyIcon}
                onClick={() => {
                  navigator.clipboard.writeText(referrerCodeUrl);
                  setCopiedReferrersCode(true);
                  setTimeout(() => setCopiedReferrersCode(false), 1200);
                }}
              >
                {copiedReferrersCode ? (
                  <Tick color="var(--primary-500-or-white)" size={14} />
                ) : (
                  <Copy color="var(--primary-500-or-white)" size={14} />
                )}
              </div>
            </span>
          </div>
        )}
        <div className={styles.referralStatCard}>
          <h4 className={styles.cardTitle}>
            Total Rewards Earned <InfoTooltip content={tooltipCopy()} />
          </h4>
          <span className={styles.rewardsAmount}>
            <img src={usdc} alt="USDC" />
            <CountUp
              key={claimedRebates}
              start={prevTotalRebateRef.current}
              end={claimedRebates}
              decimals={2}
              onEnd={() => {
                prevTotalRebateRef.current = claimedRebates;
              }}
            />
            USDC
          </span>

          <Button
            variant="secondary"
            size="small"
            onClick={claimRebates}
            disabled={!claimableRebates || claimableRebates === 0}
            wide
          >
            Claim {formatNumber(claimableRebates)} USDC
          </Button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ReferralCard);
