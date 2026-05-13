import type { KeyboardEvent } from "react";
import { useState } from "react";

import { getAssetDisplayName } from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./TokenRow.module.css";
import { tokenPath } from "../../app/routes";
import { useTokenMarketStats } from "../../hooks/useTokenMarketStats";
import { cn, formatPercentOrDash, formatUsdOrDash } from "../../utils/format";
import { tierFor } from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";
import AssetIcon from "../shared/AssetIcon";
import GraduatedPill from "../shared/GraduatedPill";
import GraduatingPill from "../shared/GraduatingPill";
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
  const organic = token.organicFilled ?? filled;
  const buyW = Math.min(organic, filled);
  const levW = Math.max(filled - buyW, 0);

  // Vanity tier overrides the ordinary mint/red border for tokens whose
  // mined address has bonus trailing zeros. The "none" tier
  // short-circuits inside `<VanityEffect>` so 99% of rows pay zero
  // wrapper cost.
  const vanityTier = tierFor(token.address);
  const hasVanityTier = vanityTier.id !== "none";

  const handleNavigate = () => navigate(tokenPath(token.address));

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleNavigate();
    }
  };

  const rowEl = (
    <div
      className={cn(
        styles.row,
        isGraduating
          ? isShort
            ? styles.graduatingShort
            : styles.graduatingLong
          : cn(
              styles.normalRow,
              isShort ? styles.borderRed : styles.borderMint,
            ),
      )}
      role="link"
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={handleKeyDown}
      aria-label={`${token.name} — ${formatPercentOrDash(stats.change24h)} — market cap ${formatUsdOrDash(stats.mcapUsd)}`}
    >
      <div className={styles.tokenCell}>
        <div className={styles.iconWrap}>
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
        <div className={styles.nameWrap}>
          <div className={styles.nameRow}>
            <span className={styles.tokenTicker}>{token.ticker}</span>
            {isGraduating && <GraduatingPill />}
            {isGraduated && <GraduatedPill />}
          </div>
          <span className={styles.tokenFullName}>{token.name}</span>
        </div>
      </div>

      {/* Underlying asset + direction/leverage. Single combined cell so
       * the row reads as `{icon} HYPE 5x Long` left-to-right rather
       * than splitting the underlying identity from its leverage
       * descriptor across two columns. Same font / weight throughout —
       * only the trailing `Nx Long/Short` span gets colour-coded so
       * the long/short bias still surfaces at a glance. */}
      <div className={styles.underlyingCell}>
        <AssetIcon
          asset={token.underlying}
          size={26}
          className={styles.underlyingLogo}
        />
        <span className={styles.underlyingName}>
          {getAssetDisplayName(token.underlying)}
        </span>
        <span
          className={cn(
            styles.underlyingDirection,
            isShort ? styles.directionShort : styles.directionLong,
          )}
        >
          {token.leverage}x {isShort ? "Short" : "Long"}
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
          isGraduated={isGraduated}
        />
      </div>

      {/* MCAP */}
      <div className={styles.mcapCell}>
        <span className={styles.mcapValue}>
          {formatUsdOrDash(stats.mcapUsd)}
        </span>
      </div>
    </div>
  );

  if (!hasVanityTier) return rowEl;
  return (
    <VanityEffect tier={vanityTier} size="row" as="block">
      {rowEl}
    </VanityEffect>
  );
}
