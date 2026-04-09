import { useEffect, useRef } from "react";

import styles from "./LivePreview.module.css";
import { COLORS, rgba } from "../../config/colors";
import {
  GRADUATION_THRESHOLD_USD,
  type UnderlyingAsset,
  type Leverage,
} from "../../config/constants";
import { MOCK_ASSET_DATA } from "../../services/mock/assets";
import { cn, formatUsd, getLtDisplayName } from "../../utils/format";

import type { Direction } from "../../services/types";


interface Props {
  name: string;
  ticker: string;
  direction: Direction;
  asset: UnderlyingAsset;
  leverage: Leverage;
  imagePreview: string | null;
}

export default function LivePreview({
  name,
  ticker,
  direction,
  asset,
  leverage,
  imagePreview,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isLong = direction === "long";
  const ltName = getLtDisplayName(asset, leverage, direction);
  const displayName = ticker
    ? `${(name || "YOUR TOKEN").toUpperCase()} (${ticker.toUpperCase()})`
    : (name || "your token").toUpperCase();
  const data = MOCK_ASSET_DATA[asset];
  const assetChg = data.change24h;
  const isUp = assetChg >= 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const color = isUp ? COLORS.mint : COLORS.red;
    const pts = Array.from({ length: 60 }, (_, i) => {
      const noise = (Math.random() - 0.48) * 1.8;
      const trend = (assetChg / 100) * (i / 60) * 0.8;
      return noise + trend;
    });
    let v = 0;
    const lineData = pts.map((p) => {
      v += p;
      return v;
    });
    const mn = Math.min(...lineData);
    const mx = Math.max(...lineData);
    const norm = lineData.map((p) => ((p - mn) / (mx - mn || 1)) * 26 + 3);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(
      0,
      isUp ? rgba(COLORS.mint, 0.18) : rgba(COLORS.red, 0.14),
    );
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(1, 32);
    norm.forEach((y, i) =>
      ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, 32 - y),
    );
    ctx.lineTo(W - 1, 32);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    norm.forEach((y, i) =>
      i === 0
        ? ctx.moveTo(1, 32 - y)
        : ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, 32 - y),
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [asset, isUp, assetChg]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.content}>
        <div className={styles.previewLabel}>
          <div className={styles.liveDot} />
          live preview
        </div>

        <div
          className={cn(
            styles.tokenCard,
            isLong ? styles.tokenCardLong : styles.tokenCardShort,
          )}
        >
          <div className={styles.tokenCardHeader}>
            <div className={styles.tokenImage}>
              {imagePreview ? (
                <img
                  src={imagePreview}
                  className={styles.tokenImageImg}
                  alt=""
                />
              ) : (
                <span className={styles.tokenImagePlaceholder}>?</span>
              )}
            </div>
            <div className={styles.tokenInfo}>
              <div className={styles.tokenName}>{displayName}</div>
              <div className={styles.tokenBadgeRow}>
                <span
                  className={cn(
                    styles.tokenBadge,
                    isLong ? styles.tokenBadgeLong : styles.tokenBadgeShort,
                  )}
                >
                  ⚡ {ltName}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.miniStats}>
            <div className={styles.miniStatCell}>
              <div className={styles.miniStatValue}>{leverage}×</div>
              <div className={styles.miniStatLabel}>leverage</div>
            </div>
            <div className={styles.miniStatCell}>
              <div className={styles.miniStatValue}>{asset}</div>
              <div className={styles.miniStatLabel}>underlying</div>
            </div>
            <div className={styles.miniStatCellLast}>
              <div
                className={cn(
                  styles.miniStatValue,
                  isLong ? styles.textMint : styles.textRed,
                )}
              >
                {isLong ? "LONG" : "SHORT"}
              </div>
              <div className={styles.miniStatLabel}>direction</div>
            </div>
          </div>
        </div>

        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <div className={styles.chartTitle}>{asset} / USD</div>
              <div className={styles.chartSubtitle}>
                your token moves {leverage}× this
              </div>
            </div>
            <div
              className={cn(
                styles.chartChgBadge,
                isUp ? styles.chartChgBadgeUp : styles.chartChgBadgeDown,
              )}
            >
              {isUp ? "+" : ""}
              {assetChg.toFixed(2)}%
            </div>
          </div>
          <div className={styles.chartBody}>
            <canvas
              ref={canvasRef}
              width={328}
              height={120}
              className={styles.canvas}
            />
          </div>
        </div>

        <div
          className={cn(
            styles.infoBox,
            isLong ? styles.infoBoxLong : styles.infoBoxShort,
          )}
        >
          <b
            className={cn(
              styles.infoBold,
              isLong ? styles.textMint : styles.textRed,
            )}
          >
            {ltName}
          </b>{" "}
          — if {asset} {isLong ? "rises" : "falls"} 10%, your token moves{" "}
          {isLong ? "up" : "down"} ~{leverage * 10}% with zero buys.
        </div>

        <div className={styles.howSection}>
          <div className={styles.howTitle}>how it works</div>
          {[
            { icon: "1", text: "Token deploys to bonding curve" },
            { icon: "2", text: "Users buy/sell with USDC atomically" },
            { icon: "3", text: `At ${formatUsd(GRADUATION_THRESHOLD_USD)} MCAP, token graduates to DEX` },
          ].map((step) => (
            <div key={step.icon} className={styles.howStep}>
              <div className={styles.howStepIcon}>{step.icon}</div>
              {step.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
