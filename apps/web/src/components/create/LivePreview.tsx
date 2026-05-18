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
import { type VanityStatus } from "../../hooks/useVanityAddress";
import {
  cn,
  formatUsd,
  getLtDisplayName,
  shortenAddress,
} from "../../utils/format";
import { srcSetFor, transformImageUrl } from "../../utils/image";
import { tierForZeros } from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";

import type { Direction } from "../../services/types";

interface Props {
  name: string;
  ticker: string;
  direction: Direction;
  asset: UnderlyingAsset;
  leverage: Leverage;
  imagePreview: string | null;
  predictedAddress: string | null;
  /**
   * Total trailing-zero count of the best-mined address. Drives the
   * tier preview on the live token card so the user sees exactly what
   * their token will look like once launched. The bonus-mining loop in
   * `useVanityAddress` only ever raises this value mid-session, so the
   * preview can only get more impressive, never less.
   */
  vanityZeros: number;
  vanityStatus: VanityStatus;
}

export default function LivePreview({
  name,
  ticker,
  direction,
  asset,
  leverage,
  imagePreview,
  predictedAddress,
  vanityZeros,
  vanityStatus,
}: Props) {
  const vanityTier = tierForZeros(vanityZeros);
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

    const color = isUp ? COLORS.mint : COLORS.red;
    const mn = Math.min(...candles);
    const mx = Math.max(...candles);
    const pad = 4;
    const norm = candles.map(
      (p) => ((p - mn) / (mx - mn || 1)) * (H - 2 * pad) + pad,
    );

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(
      0,
      isUp ? rgba(COLORS.mint, 0.18) : rgba(COLORS.red, 0.14),
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
  }, [candles, isUp]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.content}>
        <div className={styles.previewLabel}>live preview</div>

        <VanityEffect tier={vanityTier} size="card" as="block">
          <div
            className={cn(
              styles.tokenCard,
              isLong ? styles.tokenCardLong : styles.tokenCardShort,
            )}
          >
            <div className={styles.tokenCardHeader}>
              <div className={styles.tokenImage}>
                {/* Mirror the post-launch render: when no image is
                 * uploaded the home-page row falls back to the public
                 * `DEFAULT_TOKEN_IMAGE`, so previewing the same asset
                 * here tells the user exactly what their token will
                 * look like at launch. `transformImageUrl` is a no-op
                 * here — `imagePreview` is a local `blob:` URL pre-
                 * launch and `DEFAULT_TOKEN_IMAGE` is root-relative —
                 * but width/height attrs still reserve the box and
                 * prevent CLS when the blob preview swaps in. */}
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
                <div className={styles.miniStatValue}>{assetDisplay}</div>
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

            <div className={styles.addressRow}>
              <div className={styles.addressLabel}>address</div>
              {predictedAddress ? (
                // `predictedAddress` is only populated once a vanity salt has
                // been mined, so we always apply the vanity styling here.
                <div
                  className={cn(styles.addressValue, styles.addressValueVanity)}
                  title={predictedAddress}
                >
                  {shortenAddress(predictedAddress)}
                </div>
              ) : vanityStatus === "mining" ? (
                <div className={styles.addressMining}>
                  <span className={styles.miningDot} />
                  finding a memorable address…
                </div>
              ) : vanityStatus === "error" ? (
                <div className={styles.addressValue}>miner failed</div>
              ) : (
                <div className={styles.addressValue}>-</div>
              )}
            </div>
          </div>
        </VanityEffect>

        <div className={styles.chartCard}>
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
                hasChgData
                  ? isUp
                    ? styles.chartChgBadgeUp
                    : styles.chartChgBadgeDown
                  : styles.chartChgBadgeUp,
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
          <div className={styles.howTitle}>how it works</div>
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
              {step.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
