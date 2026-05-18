import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";

import styles from "./SearchModal.module.css";
import {
  cn,
  formatMcapUsdOrDash,
  formatPercentOrDash,
} from "../../utils/format";
import { srcSetFor, transformImageUrl } from "../../utils/image";
import { tierFor } from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";

import type { TokenMarketStats } from "../../hooks/useTokenMarketStats";
import type { Token } from "../../services/types";

export default function SearchTrendingCard({
  token,
  stats,
  onClick,
  highlighted,
  onMouseEnter,
}: {
  token: Token;
  /**
   * Market stats resolved by the parent `SearchModal`'s lifted
   * `useTokenMarketStatsMap(cardAddresses)` call. Lifted so the modal
   * fans out into a single bounded `POST /market-data` covering every
   * card instead of one React Query subscription per card.
   */
  stats: TokenMarketStats;
  onClick: () => void;
  highlighted?: boolean;
  onMouseEnter?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const up = (stats.change24h ?? 0) >= 0;

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [highlighted]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  const vanityTier = tierFor(token.address);
  const card = (
    <div
      ref={cardRef}
      className={cn(
        styles.trendingCard,
        highlighted && styles.trendingCardHighlighted,
      )}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      aria-label={`${token.name} — ${token.ltName}`}
    >
      <div className={styles.trendingCardHeader}>
        <div className={styles.trendingCardIcon}>
          {token.image ? (
            <img
              src={transformImageUrl(token.image, { width: 32 })}
              srcSet={srcSetFor(token.image, 32) || undefined}
              alt={token.name}
              width={26}
              height={26}
              className={styles.trendingCardImg}
              loading="lazy"
              decoding="async"
            />
          ) : (
            token.emoji
          )}
        </div>
        <div className={styles.trendingCardText}>
          <div className={styles.trendingCardName} title={token.name}>
            {token.name}
          </div>
          <div className={styles.trendingCardLtName} title={token.ltName}>
            {token.ltName}
          </div>
        </div>
      </div>
      <div className={styles.trendingCardStats}>
        <div className={styles.trendingCardMcap}>
          {formatMcapUsdOrDash(stats.mcapUsd)}
        </div>
        <div
          className={cn(
            styles.trendingCardChange,
            up ? styles.changeUp : styles.changeDown,
          )}
        >
          {formatPercentOrDash(stats.change24h)}
        </div>
      </div>
    </div>
  );

  if (vanityTier.id === "none") return card;
  return (
    <VanityEffect tier={vanityTier} size="card" as="block">
      {card}
    </VanityEffect>
  );
}
