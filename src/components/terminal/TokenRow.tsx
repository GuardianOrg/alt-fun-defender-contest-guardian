import { useNavigate } from "react-router";

import styles from "./TokenRow.module.css";
import { cn, formatUsd, formatPercent } from "../../utils/format";
import ProgressBar from "../shared/ProgressBar";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function TokenRow({ token }: Props) {
  const navigate = useNavigate();
  const isGraduating = token.status === "graduating";
  const isGraduated = token.status === "graduated";
  const isShort = token.direction === "short";
  const up = token.change24h >= 0;
  const buyW = Math.min(
    token.curveFilled - (token.leverageBoost > 0 ? token.leverageBoost : 0),
    token.curveFilled,
  );
  const levW = token.curveFilled - buyW;
  const isLtMover = token.leverageBoost > 15;

  return (
    <div
      className={cn(
        styles.row,
        isGraduating
          ? isShort
            ? styles.graduatingShort
            : styles.graduatingLong
          : cn(
              styles.normalRow,
              isShort
                ? isLtMover
                  ? styles.borderAmber
                  : styles.borderRed
                : isLtMover
                  ? styles.borderAmber
                  : styles.borderMint,
            ),
      )}
      onClick={() => navigate(`/token/${token.address}`)}
    >
      {/* Icon */}
      <div className={styles.iconCell}>
        {token.image ? (
          <img
            src={token.image}
            alt={token.name}
            className={styles.tokenImage}
          />
        ) : (
          <span className={styles.tokenEmoji}>{token.emoji}</span>
        )}
      </div>

      {/* Name + LT pair + graduating badge */}
      <div className={styles.nameCell}>
        <div className={styles.nameRow}>
          <span className={styles.tokenName}>{token.name}</span>
          <span
            className={cn(
              styles.leverageBadge,
              isShort ? styles.leverageShort : styles.leverageLong,
            )}
          >
            {token.leverage}&times;
          </span>
          {isGraduating && (
            <span
              className={cn(
                styles.gradBadge,
                isShort ? styles.gradBadgeShort : styles.gradBadgeLong,
              )}
            >
              GRAD
            </span>
          )}
        </div>
        <span
          className={cn(
            styles.ltName,
            isShort ? styles.ltNameShort : styles.ltNameLong,
          )}
        >
          {token.ltName.toUpperCase()}
          {isGraduated && " \u00B7 GRADUATED"}
        </span>
      </div>

      {/* 24h change */}
      <div className={styles.changeCell}>
        <span
          className={cn(
            styles.changeValue,
            up ? styles.changeUp : styles.changeDown,
          )}
        >
          {formatPercent(token.change24h)}
        </span>
      </div>

      {/* Progress bar */}
      <div className={styles.progressCell}>
        <ProgressBar
          buyPercent={buyW}
          leveragePercent={levW}
          isShort={isShort}
          isGraduating={isGraduating}
        />
      </div>

      {/* MCAP */}
      <div className={styles.mcapCell}>
        <span className={styles.mcapValue}>{formatUsd(token.mcapUsd)}</span>
      </div>
    </div>
  );
}
