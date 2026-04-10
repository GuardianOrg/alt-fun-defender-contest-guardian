import { useEffect, useState } from "react";

import confetti from "canvas-confetti";
import { useDispatch, useSelector } from "react-redux";

import styles from "./BetaInviteCodes.module.css";
import {
  HAS_REGISTERED_API,
  INVITE_CODES_API,
  REGISTER_API,
} from "../../../app/api";
import usedIcon from "../../../assets/check.svg";
import { HAS_REGISTERED_ID } from "../../../handlers/HasRegisteredHandler";
import useSignMessage from "../../../hooks/useSignMessage";
import { useUserHasRegistered } from "../../../hooks/useUserHasRegistered";
import { setError } from "../../../state/errorSlice";
import {
  selectInviteCode,
  selectSignature,
  setHasRegistered,
} from "../../../state/registerSlice";
import Button from "../../Global/Buttons/Button";

interface CodeType {
  code: string;
  createdAt: number;
  creator: string;
  used: boolean;
}

const DUMMY_CODE: CodeType = {
  code: "****",
  createdAt: 1753902018201,
  creator: "0x818C11170dDad89B6E815C1794BECa36eE19FA01",
  used: false,
};

const BetaInviteCodes = () => {
  const dispatch = useDispatch();
  const signMessage = useSignMessage();
  const { hasRegistered, refetch } = useUserHasRegistered();
  const [codes, setCodes] = useState<CodeType[]>([
    DUMMY_CODE,
    DUMMY_CODE,
    DUMMY_CODE,
    DUMMY_CODE,
    DUMMY_CODE,
  ]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const signature = useSelector(selectSignature);
  const inviteCode = useSelector(selectInviteCode);

  useEffect(() => {
    if (!signature) return;
    if (hasRegistered) return;
    fetch(`${HAS_REGISTERED_API}?signature=${signature}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.hasRegistered) {
          dispatch(setHasRegistered(true));
          localStorage.setItem(HAS_REGISTERED_ID, "true");
          return;
        }
        if (!inviteCode) return;
        fetch(REGISTER_API, {
          method: "POST",
          body: JSON.stringify({
            inviteCode,
            signature,
          }),
        })
          .then((res) => {
            if (!res.ok) {
              dispatch(
                setError({
                  message: "Error registering, please try again.",
                  details: `Status code: ${res.status}. ${res.statusText}`,
                }),
              );
              return;
            }
            refetch();
            dispatch(setHasRegistered(true));
            localStorage.setItem(HAS_REGISTERED_ID, "true");
            setTimeout(() => {
              confetti({
                particleCount: 200,
                spread: 90,
                origin: { x: 0.5, y: 0.3 },
                colors: ["#6753f1", "#ece3ff", "#dcebff", "#f3f3f7", "#8f8f9c"],
                scalar: 1.5,
                startVelocity: 60,
                zIndex: 300,
              });
            }, 500);
          })
          .catch((err) => {
            dispatch(
              setError({
                message: "Error registering, please try again.",
                details: err,
              }),
            );
          });
      });
  }, [signature, inviteCode, hasRegistered, dispatch, refetch]);

  useEffect(() => {
    if (!hasRegistered) return;
    if (!signature) return;
    fetch(`${INVITE_CODES_API}?signature=${signature}`)
      .then((res) => res.json())
      .then((data) => {
        const codes = Object.values(data) as CodeType[];
        setCodes(codes);
      });
  }, [hasRegistered, signature]);

  return (
    <div
      className={`globalCard ${styles.inviteCodes} ${
        hasRegistered ? "" : styles.notClickable
      }`}
    >
      <h2 className={styles.header}>Invite codes</h2>
      {!hasRegistered && (
        <div className={styles.helpText}>
          Complete registration to generate your single use invite codes.
        </div>
      )}

      {hasRegistered && !signature && (
        <a
          className={`${styles.helpText} ${styles.resign}`}
          onClick={() => signMessage()}
        >
          Re-sign signature to view your invite codes.
        </a>
      )}
      {hasRegistered && signature && (
        <div className={styles.helpText}>
          Use these codes to invite your friends to our beta launch.
        </div>
      )}
      {codes.map((code, index) => (
        <div
          className={`${styles.codeContainer} ${
            hasRegistered && signature ? "" : styles.isTransparent
          }`}
          key={index}
        >
          <div className={styles.code}>
            {code.code}
            {code.used && (
              <div className={styles.usedContainer}>
                <img className={styles.usedIcon} src={usedIcon} />
                <div className={styles.usedText}>Used</div>
              </div>
            )}
          </div>
          <div className={styles.buttonContainer}>
            <Button
              disabled={code.used}
              variant="primary"
              right
              onClick={() => {
                navigator.clipboard.writeText(code.code);
                setCopiedIndex(index);
              }}
              wide
            >
              {copiedIndex === index ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default BetaInviteCodes;
