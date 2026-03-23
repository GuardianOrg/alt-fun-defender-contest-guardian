import { useEffect, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { useDispatch, useSelector } from "react-redux";
import { useConnect } from "wagmi";

import styles from "./BetaRegisterPage.module.css";
import { DISCORD_LINK, X_LINK } from "../../app/links";
import checkIcon from "../../assets/check.svg";
import greebleSquare from "../../assets/greeble-square.png";
import AnimatePresenceHeight from "../../components/Global/AnimatePresenceHeight/AnimatePresenceHeight";
import Button from "../../components/Global/Buttons/Button";
import CorePageTitle from "../../components/Global/CorePageTitle/CorePageTitle";
import Seo from "../../components/Global/Seo";
import BetaInviteCodeClaimer from "../../components/RegisterPage/BetaInviteCodeClaimer/BetaInviteCodeClaimer";
import BetaInviteCodes from "../../components/RegisterPage/BetaInviteCodes/BetaInviteCodes";
import RegistrationComplete from "../../components/RegisterPage/RegistrationComplete/RegistrationComplete";
import useSignMessage from "../../hooks/useSignMessage";
import { useUserHasRegistered } from "../../hooks/useUserHasRegistered";
import { setError } from "../../state/errorSlice";
import {
  selectSignature,
  setInviteCode,
  setSignature,
} from "../../state/registerSlice";
import useBounceAccount from "../../web3/views/useBounceAccount";

export const DISCORD_AUTH = `https://discord.com/oauth2/authorize?client_id=1399016740100374538&redirect_uri=https://bounce.tech/register&response_type=code&scope=identify%20guilds`;

const RegisterPage = () => {
  const dispatch = useDispatch();
  const { error } = useConnect();
  const { address, isConnected } = useBounceAccount();
  const signMessage = useSignMessage();
  const { hasRegistered: registrationComplete } = useUserHasRegistered();

  const signature = useSelector(selectSignature);
  const [isEnteringCode, setIsEnteringCode] = useState(false);

  const hasSigned = !!signature;

  const signingComplete = hasSigned;
  const inviteComplete = registrationComplete;

  const signingActive = !hasSigned;
  const inviteActive = signingComplete && !inviteComplete;

  useEffect(() => {
    if (error) {
      dispatch(
        setError({
          message: "We could not connect to your wallet, please try again.",
          details: error.message,
        }),
      );
    }
  }, [error, dispatch]);

  useEffect(() => {
    dispatch(setSignature(null));
    dispatch(setInviteCode(null));
    localStorage.removeItem("bounce-invite-code");
  }, [address, dispatch]);

  const progress = () => {
    if (registrationComplete) return 100;
    if (hasSigned) return 50;
    if (isConnected) return 12.5;
    return 0;
  };

  const currentProgress = progress();

  return (
    <>
      <Seo title="Bounce Registration" description="Register for Bounce." />
      <div className={`globalPage ${styles.registerPage}`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ width: "100%" }}
        >
          <CorePageTitle title="Bounce" titleHighlight="Registration" />
        </motion.div>
        <AnimatePresenceHeight
          shouldDisplay={registrationComplete === true}
          className={styles.registrationCompleteContainer}
          duration={0.5}
        >
          <RegistrationComplete />
        </AnimatePresenceHeight>
        {registrationComplete !== null && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
              style={{ width: "100%" }}
            >
              <div className={styles.mainSection}>
                <div className={`globalCard ${styles.registerSection}`}>
                  <div className={styles.buttonContainer}>
                    {isConnected ? (
                      <Button
                        variant={
                          !signingActive || registrationComplete
                            ? "outlined"
                            : "primary"
                        }
                        icon={
                          signingComplete || registrationComplete
                            ? checkIcon
                            : undefined
                        }
                        onClick={() => signMessage()}
                        disabled={
                          !signingActive || Boolean(registrationComplete)
                        }
                      >
                        Sign Message
                      </Button>
                    ) : (
                      <Button variant="primary" addressRequired />
                    )}
                    <Button
                      variant={!inviteComplete ? "primary" : "outlined"}
                      icon={inviteComplete ? checkIcon : undefined}
                      disabled={!inviteActive}
                      onClick={() => {
                        setIsEnteringCode(true);
                      }}
                    >
                      Add Invite Code
                    </Button>
                    <AnimatePresence>
                      {registrationComplete && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 1, ease: "easeOut" }}
                          className={styles.animatedButton}
                        >
                          <Button
                            variant={"secondary"}
                            onClick={() => {
                              window.open(X_LINK, "_blank")?.focus();
                            }}
                          >
                            Follow on X
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {registrationComplete && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 1, ease: "easeOut" }}
                          className={styles.animatedButton}
                        >
                          <Button
                            variant={"secondary"}
                            onClick={() =>
                              window.open(DISCORD_LINK, "_blank")?.focus()
                            }
                          >
                            Join our Discord
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {!registrationComplete && (
                    <p className={styles.helpText}>
                      Don't have an invite code? DM us on{" "}
                      <a
                        className={styles.helpTextLink}
                        href={X_LINK}
                        target="_blank"
                      >
                        X
                      </a>
                    </p>
                  )}
                  <div className={styles.progressBarContainer}>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressBarFill}
                        style={{ width: `${currentProgress}%` }}
                      />
                    </div>
                    <div className={styles.progressBarTextContainer}>
                      <p className={styles.progressBarText}>
                        {currentProgress === 100
                          ? "Registration completed!"
                          : "Progress"}
                      </p>
                      <p className={styles.progressBarText}>{`${Math.round(
                        (currentProgress / 100) * 2,
                      )}/2`}</p>
                    </div>
                  </div>
                </div>
                <img
                  src={greebleSquare}
                  className={`${styles.greebleSquare} ${
                    registrationComplete ? styles.complete : ""
                  }`}
                />
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
              style={{ width: "100%", zIndex: 1 }}
            >
              <BetaInviteCodes />
            </motion.div>
          </>
        )}
      </div>
      <BetaInviteCodeClaimer
        show={isEnteringCode}
        close={() => setIsEnteringCode(false)}
      />
    </>
  );
};

export default RegisterPage;
