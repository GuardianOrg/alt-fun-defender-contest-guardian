import { useEffect, useRef } from "react";

import {
  getAssetDisplayName,
  DEFAULT_GRADUATION_THRESHOLD_USD,
} from "@launchpad/shared";

import styles from "./LivePreview.module.css";
import { COLORS, rgba } from "../../config/colors";
import {
  DEFAULT_TOKEN_IMAGE,
  type UnderlyingAsset,
  type Leverage,
} from "../../config/constants";
import { useAssetCandles, useAssetChange } from "../../hooks/useAssets";
import {
  cn,
  formatUsd,
  getLtDisplayName,
} from "../../utils/format";
import { srcSetFor, transformImageUrl } from "../../utils/image";

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
  const assetDisplay = getAssetDisplayName(asset);
  const ltName = getLtDisplayName(asset, leverage, direction);
  const displayName = ticker
    ? `${(name || "YOUR TOKEN").toUpperCase()} (${ticker.toUpperCase()})`
    : (name || "your token").toUpperCase();
  const rawAssetChg = useAssetChange(asset);
  const assetChg = rawAssetChg ?? 0;
  const hasChgData = rawAssetChg != null;
  const isUp = assetChg >= 0;
  const { data: candles } = useAssetCandles(asset);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles || candles.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const color = isLong ? COLORS.mint : COLORS.red;
    const mn = Math.min(...candles);
    const mx = Math.max(...candles);
    const pad = 4;
    const norm = candles.map(
      (p) => ((p - mn) / (mx - mn || 1)) * (H - 2 * pad) + pad,
    );

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(
      0,
      isLong ? rgba(COLORS.mint, 0.18) : rgba(COLORS.red, 0.14),
    );
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(1, H);
    norm.forEach((y, i) =>
      ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, H - y),
    );
    ctx.lineTo(W - 1, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    norm.forEach((y, i) =>
      i === 0
        ? ctx.moveTo(1, H - y)
        : ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, H - y),
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [candles, isLong]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.content}>
        <div className={cn(styles.previewLabel, "ui-subheading")}>
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
              {/* Mirror the post-launch render. */}
              {(() => {
                const src = imagePreview ?? DEFAULT_TOKEN_IMAGE;
                return (
                  <img
                    src={transformImageUrl(src, { width: 64 })}
                    srcSet={srcSetFor(src, 64) || undefined}
                    width={64}
                    height={64}
                    className={styles.tokenImageImg}
                    alt=""
                    decoding="async"
                  />
                );
              })()}
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
                  {ltName}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.miniStats}>
            <div className={styles.miniStatCell}>
              <div className={styles.miniStatValue}>{leverage}×</div>
              <div className={cn(styles.miniStatLabel, "ui-subheading")}>
                leverage
              </div>
            </div>
            <div className={styles.miniStatCell}>
              <div className={styles.miniStatValue}>{assetDisplay}</div>
              <div className={cn(styles.miniStatLabel, "ui-subheading")}>
                underlying
              </div>
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
              <div className={cn(styles.miniStatLabel, "ui-subheading")}>
                direction
              </div>
            </div>
          </div>
        </div>

        <div
          className={cn(
            styles.chartCard,
            isLong ? styles.chartCardLong : styles.chartCardShort,
          )}
        >
          <div className={styles.chartHeader}>
            <div>
              <div className={styles.chartTitle}>{assetDisplay} / USD</div>
              <div className={styles.chartSubtitle}>
                your token moves {leverage}× this
              </div>
            </div>
            <div
              className={cn(
                styles.chartChgBadge,
                isLong ? styles.chartChgBadgeUp : styles.chartChgBadgeDown,
              )}
            >
              {hasChgData ? `${isUp ? "+" : ""}${assetChg.toFixed(2)}%` : "-"}
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
          - if {assetDisplay} {isLong ? "rises" : "falls"} 10%, your token pumps{" "}
          ~{leverage * 10}% with zero buys.
        </div>

        <div className={styles.howSection}>
          <div className={cn(styles.howTitle, "ui-subheading")}>
            how it works
          </div>
          {[
            { icon: "1", text: "Token deploys to bonding curve" },
            { icon: "2", text: "Users buy/sell with USDC atomically" },
            {
              icon: "3",
              text: `At ${formatUsd(DEFAULT_GRADUATION_THRESHOLD_USD)} MCAP, token graduates to DEX`,
            },
          ].map((step) => (
            <div key={step.icon} className={styles.howStep}>
              <div className={styles.howStepIcon}>{step.icon}</div>
              <span className={styles.howStepText}>{step.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
