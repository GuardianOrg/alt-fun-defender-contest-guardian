import type { KeyboardEvent } from "react";
import { useState } from "react";

import { useNavigate } from "react-router";

import styles from "./TokenRow.module.css";
import { tokenPath } from "../../app/routes";
import { useTokenMarketStats } from "../../hooks/useTokenMarketStats";
import {
  cn,
  formatPercentOrDash,
  formatUsdOrDash,
} from "../../utils/format";
import ProgressBar from "../shared/ProgressBar";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function TokenRow({ token }: Props) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const stats = useTokenMarketStats(token.address);
  const isGraduating = token.status === "graduating";
  const isGraduated = token.status === "graduated";
  const isShort = token.direction === "short";
  const up = (stats.change24h ?? 0) >= 0;
  // Width math renders `null` (unknown) as an empty bar — we can't guess
  // progress, so we show none. The text-only sites use `formatCurveFilled`
  // which renders `—` instead.
  const filled = token.curveFilled ?? 0;
  const buyW = Math.min(
    filled - (token.leverageBoost > 0 ? token.leverageBoost : 0),
    filled,
  );
  const levW = filled - buyW;
  const isLtMover = token.leverageBoost > 15;

  const handleNavigate = () => navigate(tokenPath(token.address));

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleNavigate();
    }
  };

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
      role="link"
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={handleKeyDown}
      aria-label={`${token.name} — ${formatPercentOrDash(stats.change24h)} — market cap ${formatUsdOrDash(stats.mcapUsd)}`}
    >
      {/* Icon */}
      <div className={styles.iconCell}>
        {token.image && !imgError ? (
          <img
            key={token.image}
            src={token.image}
            alt={token.name}
            className={styles.tokenImage}
            onError={() => setImgError(true)}
          />
        ) : (
          <span className={styles.tokenEmoji}>{token.emoji || "🪙"}</span>
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
          {formatPercentOrDash(stats.change24h)}
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
        <span className={styles.mcapValue}>{formatUsdOrDash(stats.mcapUsd)}</span>
      </div>
    </div>
  );
}
