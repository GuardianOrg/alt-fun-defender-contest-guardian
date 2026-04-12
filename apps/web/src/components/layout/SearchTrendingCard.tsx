import { useMemo, useRef, useEffect, useState } from "react";

import styles from "./SearchModal.module.css";
import { COLORS } from "../../config/colors";
import { cn } from "../../utils/format";

import type { Token } from "../../services/types";

function normalizePoints(pts: number[]): string {
  if (pts.length < 2) return "1,16 109,16";
  const mn = Math.min(...pts);
  const mx = Math.max(...pts);
  const norm = pts.map((p) => ((p - mn) / (mx - mn || 1)) * 26 + 3);
  return norm
    .map((y, i) => `${(i / (norm.length - 1)) * 108 + 1},${32 - y}`)
    .join(" ");
}

function Sparkline({ up, data }: { up: boolean; data?: number[] }) {
  const coords = useMemo(() => {
    if (data && data.length >= 2) {
      return normalizePoints(data);
    }
    const pts = Array.from({ length: 12 }, (_, i) => (up ? i * 2.2 : -i * 2));
    return normalizePoints(pts);
  }, [up, data]);
  const col = up ? COLORS.mint : COLORS.red;
  return (
    <svg
      width="110"
      height="32"
      viewBox="0 0 110 32"
      preserveAspectRatio="none"
      className={styles.sparkline}
    >
      <polygon points={`1,32 ${coords} 109,32`} fill={col} opacity="0.08" />
      <polyline
        points={coords}
        fill="none"
        stroke={col}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function useIsVisible() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

export default function SearchTrendingCard({
  token,
  sparklineData,
  onClick,
}: {
  token: Token;
  sparklineData?: number[];
  onClick: () => void;
}) {
  const up = token.change24h >= 0;
  const { ref, visible } = useIsVisible();
  return (
    <div ref={ref} className={styles.trendingCard} onClick={onClick}>
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
        <div>
          <div className={styles.trendingCardName}>{token.name}</div>
          <div className={styles.trendingCardLtName}>{token.ltName}</div>
        </div>
      </div>
      <Sparkline up={up} data={visible ? sparklineData : undefined} />
      <div className={styles.trendingCardMcap}>
        $
        {token.mcapUsd >= 1_000_000
          ? `${(token.mcapUsd / 1_000_000).toFixed(2)}M`
          : `${(token.mcapUsd / 1_000).toFixed(1)}K`}
      </div>
      <div
        className={cn(
          styles.trendingCardChange,
          up ? styles.changeUp : styles.changeDown,
        )}
      >
        {up ? "+" : ""}
        {token.change24h}%
      </div>
    </div>
  );
}
