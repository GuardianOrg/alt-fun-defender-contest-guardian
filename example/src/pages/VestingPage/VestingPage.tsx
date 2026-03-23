import { useRef } from "react";

import { motion } from "framer-motion";
import CountUp from "react-countup";
import { useDispatch } from "react-redux";

import styles from "./VestingPage.module.css";
import bounceToken from "../../assets/bounce-token.svg";
import Button from "../../components/Global/Buttons/Button";
import Connector from "../../components/Global/Connector/Connector";
import CorePageContainer from "../../components/Global/CorePageContainer/CorePageContainer";
import CorePageTitle from "../../components/Global/CorePageTitle/CorePageTitle";
import Seo from "../../components/Global/Seo";
import ZeroStateContainer from "../../components/Global/ZeroStateContainer/ZeroStateContainer";
import { setError } from "../../state/errorSlice";
import { formatBalance } from "../../utils/formatBalance.util";
import useBounceAccount from "../../web3/views/useBounceAccount";
import useVesting from "../../web3/views/useVesting";
import useClaimVesting from "../../web3/writes/useClaimVesting";

const VestingPage = () => {
  const dispatch = useDispatch();
  const { isConnected } = useBounceAccount();
  const data = useVesting();
  const { claimVesting, isConnecting, isPending } = useClaimVesting();

  const vestingData = {
    totalAllocation: data ? formatBalance(data.amount, 18, 2) : "--",
    vested: data ? formatBalance(data.vested, 18, 2) : "--",
    claimed: data ? formatBalance(data.claimed, 18, 2) : "--",
    claimable: data ? formatBalance(data.claimable, 18, 2) : "--",
    startDate: data
      ? new Date(Number(data.start) * 1000).toLocaleDateString()
      : "--",
    endDate: data
      ? new Date(Number(data.end) * 1000).toLocaleDateString()
      : "--",
  };

  const vestingTable = Object.entries({
    "Total token allocation": vestingData.totalAllocation,
    "Vested tokens": vestingData.vested,
    "Amount claimed so far": vestingData.claimed,
    "Amount claimable": vestingData.claimable,
    "Vesting start date": vestingData.startDate,
    "Vesting end date": vestingData.endDate,
  }).map(([label, value]) => ({ label, value }));

  const handleClaimVesting = async () => {
    try {
      await claimVesting();
    } catch (error) {
      dispatch(
        setError({
          message:
            "There was a problem claiming your vesting, please try again.",
          details: error as string,
        }),
      );
    }
  };

  const prevClaimedRef = useRef(0);
  const prevClaimableRef = useRef(0);
  const claimed =
    vestingData.claimed === "--"
      ? "--"
      : Number(vestingData.claimed.replace(/,/g, "")) === 0
        ? 0
        : Number(vestingData.claimed.replace(/,/g, ""));
  const claimable =
    vestingData.claimable === "--"
      ? "--"
      : Number(vestingData.claimable.replace(/,/g, "")) === 0
        ? 0
        : Number(vestingData.claimable.replace(/,/g, ""));

  return (
    <>
      <Seo
        title="Vesting"
        description="Vesting Page, claim your BOUNCE tokens"
      />
      <CorePageContainer>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ width: "100%" }}
        >
          <CorePageTitle title="Vesting" titleHighlight="BOUNCE" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
          style={{ width: "100%" }}
        >
          {!isConnected ? (
            <ZeroStateContainer>
              <p>Connect your wallet to view your vesting</p>
              <Connector />
            </ZeroStateContainer>
          ) : (
            <div className={styles.mainCard}>
              <>
                <h3 className={styles.subheader}>Your tokens</h3>
                <div className={styles.totalVestingContainer}>
                  <div className={styles.totalTokenContainer}>
                    <img src={bounceToken} alt="Liquidation points icon" />
                    <p className={styles.tokenName}>BOUNCE</p>
                  </div>
                  <div className={styles.totalAmountContainer}>
                    <p>
                      {claimed !== "--" ? (
                        <CountUp
                          key={claimed}
                          start={prevClaimedRef.current}
                          end={claimed}
                          onEnd={() => {
                            prevClaimedRef.current = claimed;
                          }}
                        />
                      ) : (
                        "--"
                      )}{" "}
                      / {vestingData.totalAllocation}
                    </p>
                  </div>
                </div>
              </>
              <table className={styles.table}>
                <tbody>
                  {vestingTable.map((row, idx) => (
                    <tr key={idx}>
                      <td className={styles.label}>{row.label}</td>
                      <td className={styles.value}>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <>
                <h3 className={styles.subheader}>Available to claim</h3>
                <div className={styles.claimAmountContainer}>
                  <div className={styles.tokenContainer}>
                    <img src={bounceToken} alt="Liquidation points icon" />
                    <p>BOUNCE</p>
                  </div>
                  <div className={styles.amountContainer}>
                    <p>
                      {claimable !== "--" ? (
                        <CountUp
                          key={claimable}
                          start={prevClaimableRef.current}
                          end={claimable}
                          onEnd={() => {
                            prevClaimableRef.current = claimable;
                          }}
                        />
                      ) : (
                        "--"
                      )}{" "}
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  onClick={handleClaimVesting}
                  loading={isConnecting}
                  disabled={
                    isPending ||
                    vestingData.claimable === "0" ||
                    vestingData.claimable === "--"
                  }
                >
                  {isPending
                    ? "Claim pending"
                    : claimable === 0
                      ? "Vesting claimed!"
                      : "Claim available BOUNCE"}
                </Button>
              </>
            </div>
          )}
        </motion.div>
      </CorePageContainer>
    </>
  );
};

export default VestingPage;
