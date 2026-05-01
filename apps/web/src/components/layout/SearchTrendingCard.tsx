import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";

import styles from "./SearchModal.module.css";
import { useTokenMarketStats } from "../../hooks/useTokenMarketStats";
import {
  cn,
  formatPercentOrDash,
  formatUsdOrDash,
} from "../../utils/format";
import { tierFor } from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";

import type { Token } from "../../services/types";

export default function SearchTrendingCard({
  token,
  onClick,
  highlighted,
  onMouseEnter,
}: {
  token: Token;
  onClick: () => void;
  highlighted?: boolean;
  onMouseEnter?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const stats = useTokenMarketStats(token.address);
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
              src={token.image}
              alt={token.name}
              className={styles.trendingCardImg}
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
          {formatUsdOrDash(stats.mcapUsd)}
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
