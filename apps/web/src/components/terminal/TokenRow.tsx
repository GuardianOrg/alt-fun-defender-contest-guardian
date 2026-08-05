import type { KeyboardEvent } from "react";
import { useState } from "react";

import { getAssetDisplayName } from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./TokenRow.module.css";
import { tokenPath } from "../../app/routes";
import {
  cn,
  formatMcapUsd,
  formatMcapUsdOrDash,
  formatPercentOrDash,
  isRecentlyDeployed,
} from "../../utils/format";
import { srcSetFor, transformImageUrl } from "../../utils/image";
import AssetIcon from "../shared/AssetIcon";
import CommunityTakeoverPill from "../shared/CommunityTakeoverPill";
import GraduatedPill from "../shared/GraduatedPill";
import GraduatingPill from "../shared/GraduatingPill";
import ProgressBar from "../shared/ProgressBar";
import RollingNumber from "../shared/RollingNumber";

import type { TokenMarketStats } from "../../hooks/useTokenMarketStats";
import type { Token } from "../../services/types";
import type { TokenViewMode } from "../../state/uiSlice";

interface Props {
  token: Token;
  /** Market stats are lifted to `TokenTable` so each page makes one bounded request. */
  stats: TokenMarketStats;
  /** Flash newly arrived rows from live WS updates or dev-injected mock tokens. */
  isNew?: boolean;
  /** Eager-load above-the-fold token logos for LCP. */
  eager?: boolean;
  viewMode: TokenViewMode;
}

export default function TokenRow({
  token,
  stats,
  isNew = false,
  eager = false,
  viewMode,
}: Props) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const isGraduating = token.status === "graduating";
  const isGraduated = token.status === "graduated";
  const isShort = token.direction === "short";
  // Fresh tokens cannot have a meaningful 24h comparison yet; older nulls stay visible as degraded data.
  const fresh = isRecentlyDeployed(token.createdAt);
  const changeDisplay = stats.change24h ?? (fresh ? 0 : null);
  const mcapDisplay = stats.mcapUsd ?? (fresh ? 0 : null);
  const up = (changeDisplay ?? 0) >= 0;
  // Unknown progress renders as an empty bar rather than guessed fill.
  const filled = token.curveFilled ?? 0;
  const organic = token.organicFilled ?? filled;
  const buyW = Math.min(organic, filled);
  const levW = Math.max(filled - buyW, 0);

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
        viewMode === "grid" && styles.cardRow,
        isGraduating
          ? isShort
            ? styles.graduatingShort
            : styles.graduatingLong
          : cn(
              styles.normalRow,
              isShort ? styles.borderRed : styles.borderMint,
            ),
        isNew && styles.flashNew,
      )}
      role="link"
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={handleKeyDown}
      aria-label={`${token.name} — ${formatPercentOrDash(changeDisplay)} — market cap ${formatMcapUsdOrDash(mcapDisplay)}`}
    >
      <div className={styles.tokenCell}>
        <div className={styles.iconWrap}>
          {token.image && !imgError ? (
            <img
              key={token.image}
              src={transformImageUrl(token.image, { width: 64 })}
              srcSet={srcSetFor(token.image, 64) || undefined}
              alt={token.name}
              width={64}
              height={64}
              className={styles.tokenImage}
              onError={() => setImgError(true)}
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : "auto"}
              decoding="async"
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
            {token.communityTakeoverAt && <CommunityTakeoverPill />}
          </div>
          <span className={styles.tokenFullName}>{token.name}</span>
        </div>
      </div>

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

      <div className={styles.changeCell}>
        <span
          className={cn(
            styles.changeValue,
            up ? styles.changeUp : styles.changeDown,
          )}
        >
          {formatPercentOrDash(changeDisplay)}
        </span>
      </div>

      <div className={styles.progressCell}>
        <ProgressBar
          buyPercent={buyW}
          leveragePercent={levW}
          isShort={isShort}
          isGraduating={isGraduating}
          isGraduated={isGraduated}
        />
      </div>

      {/* Pass raw mcap so the fresh-token `$0` fallback does not become a tween baseline. */}
      <div className={styles.mcapCell}>
        <RollingNumber
          className={styles.mcapValue}
          value={stats.mcapUsd}
          format={formatMcapUsd}
          trend="up"
          dashFallback={fresh ? formatMcapUsd(0) : "—"}
        />
      </div>
    </div>
  );
}
