import { useEffect, useState } from "react";

import { useDispatch } from "react-redux";

import styles from "./BetaInviteCodeClaimer.module.css";
import { INVITE_CODE_API } from "../../../app/api";
import { X_LINK } from "../../../app/links";
import useLiquidationJourneyData from "../../../hooks/useLiquidationJourneyData";
import { useUserHasRegistered } from "../../../hooks/useUserHasRegistered";
import { setInviteCode } from "../../../state/registerSlice";
import useBounceAccount from "../../../web3/views/useBounceAccount";
import Button from "../../Global/Buttons/Button";
import Error from "../../Global/Error/Error";
import Input from "../../Global/Input/Input";
import Popup from "../../Global/Popup/Popup";

interface InviteCodeProps {
  show: boolean;
  close: () => void;
}

const BetaInviteCodeClaimer = ({ show, close }: InviteCodeProps) => {
  const dispatch = useDispatch();
  const referralCode = localStorage.getItem("referral_code");
  const { address } = useBounceAccount();
  const { data: liquidationJourneyData } = useLiquidationJourneyData(address);
  const hasClaimedScore = liquidationJourneyData?.hasClaimed;
  const hasClaimedLiquidationScoreLocally = localStorage.getItem(
    "hasClaimedLiquidationScore",
  );
  const hasClaimed = hasClaimedScore || hasClaimedLiquidationScoreLocally;
  const noLiquidations = localStorage.getItem("no_liquidations");

  const { hasRegistered } = useUserHasRegistered();
  const [inviteCodeInput, setInviteCodeInput] = useState(
    referralCode
      ? referralCode
      : hasClaimed
        ? "liquidation_score_claimed"
        : noLiquidations
          ? "no_liquidations"
          : "",
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = () => {
    if (loading) return;

    if (!inviteCodeInput) {
      setErrorMessage("Please enter an invite code");
      return;
    }

    setLoading(true);
    fetch(`${INVITE_CODE_API}?inviteCode=${inviteCodeInput}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setLoading(false);
          setErrorMessage(data.error);
          return;
        }

        if (data) {
          setLoading(false);
          setErrorMessage("Invite code already used");
          return;
        }

        localStorage.setItem("bounce-invite-code", inviteCodeInput);
        dispatch(setInviteCode(inviteCodeInput));
      });
  };

  useEffect(() => {
    if (hasRegistered) {
      setLoading(false);
      close();
    }
  }, [hasRegistered, close]);

  return (
    <Popup show={show} close={close} header="Enter Invite Code">
      <div className={styles.codeInputContainer}>
        <Input
          value={inviteCodeInput}
          onChange={(value) => setInviteCodeInput(value)}
          placeholder="Enter invite code"
        />
        <Button variant="primary" onClick={handleSubmit} loading={loading}>
          Submit
        </Button>
      </div>
      <p className={styles.helpText}>
        Don't have an invite code? DM us on{" "}
        <a className={styles.helpTextLink} href={X_LINK} target="_blank">
          X
        </a>
      </p>
      {errorMessage && <Error message={errorMessage} />}
    </Popup>
  );
};

export default BetaInviteCodeClaimer;
