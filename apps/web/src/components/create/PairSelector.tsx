import styles from "./PairSelector.module.css";
import StepHeader from "./StepHeader";
import { COLORS, rgba } from "../../config/colors";
import { UNDERLYING_ASSETS, LEVERAGE_OPTIONS } from "../../config/constants";
import { useAssetChanges } from "../../hooks/useAssets";
import { cn, getLtDisplayName } from "../../utils/format";

import type { UnderlyingAsset, Leverage } from "../../config/constants";
import type { Direction } from "../../services/types";

interface Props {
  direction: Direction;
  asset: UnderlyingAsset;
  leverage: Leverage;
  onDirectionChange: (d: Direction) => void;
  onAssetChange: (a: UnderlyingAsset) => void;
  onLeverageChange: (l: Leverage) => void;
}

export default function PairSelector({
  direction,
  asset,
  leverage,
  onDirectionChange,
  onAssetChange,
  onLeverageChange,
}: Props) {
  const assetChanges = useAssetChanges();
  const isLong = direction === "long";
  const baseChg = assetChanges[asset] ?? 0;
  const chg = isLong ? baseChg * leverage : -baseChg * leverage;

  return (
    <div>
      <StepHeader
        step={1}
        title="Choose your pair"
        subtitle="Pick a direction and underlying asset."
      />

      <div className={styles.directionGrid}>
        <button
          className={cn(
            styles.directionCard,
            isLong
              ? styles.directionCardLongActive
              : styles.directionCardInactive,
          )}
          onClick={() => onDirectionChange("long")}
        >
          <div className={styles.cardHeader}>
            <div
              className={cn(
                styles.directionTitle,
                isLong ? styles.directionTitleMint : styles.directionTitleMuted,
              )}
            >
              LONG
            </div>
            <svg width="52" height="28" viewBox="0 0 52 28" fill="none">
              <polyline
                points="0,24 10,20 20,14 30,10 40,5 52,2"
                stroke={isLong ? COLORS.mint : rgba(COLORS.text, 0.15)}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon
                points="0,28 0,24 10,20 20,14 30,10 40,5 52,2 52,28"
                fill={
                  isLong ? rgba(COLORS.mint, 0.12) : rgba(COLORS.text, 0.03)
                }
              />
            </svg>
          </div>
          <div className={styles.cardDesc}>
            token moves up when underlying pumps
          </div>
          <div
            className={cn(
              styles.cardBadge,
              isLong ? styles.cardBadgeMintActive : styles.cardBadgeInactive,
            )}
          >
            bullish
          </div>
        </button>

        <button
          className={cn(
            styles.directionCard,
            !isLong
              ? styles.directionCardShortActive
              : styles.directionCardInactive,
          )}
          onClick={() => onDirectionChange("short")}
        >
          <div className={styles.cardHeader}>
            <div
              className={cn(
                styles.directionTitle,
                !isLong ? styles.directionTitleRed : styles.directionTitleMuted,
              )}
            >
              SHORT
            </div>
            <svg width="52" height="28" viewBox="0 0 52 28" fill="none">
              <polyline
                points="0,4 10,7 20,12 30,17 40,22 52,26"
                stroke={!isLong ? COLORS.red : rgba(COLORS.text, 0.15)}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon
                points="0,0 0,4 10,7 20,12 30,17 40,22 52,26 52,0"
                fill={
                  !isLong ? rgba(COLORS.red, 0.1) : rgba(COLORS.text, 0.03)
                }
              />
            </svg>
          </div>
          <div className={styles.cardDesc}>
            token moves up when underlying dumps
          </div>
          <div
            className={cn(
              styles.cardBadge,
              !isLong ? styles.cardBadgeRedActive : styles.cardBadgeInactive,
            )}
          >
            bearish
          </div>
        </button>
      </div>

      <label className={styles.label}>Underlying asset</label>
      <div className={styles.assetGrid}>
        {UNDERLYING_ASSETS.map((a) => {
          const change = assetChanges[a] ?? 0;
          const up = change >= 0;
          const selected = a === asset;
          return (
            <button
              key={a}
              className={cn(
                styles.assetButton,
                selected
                  ? isLong
                    ? styles.assetButtonMintSelected
                    : styles.assetButtonRedSelected
                  : styles.assetButtonUnselected,
              )}
              onClick={() => onAssetChange(a)}
            >
              <div className={styles.assetName}>{a}</div>
              <div
                className={cn(
                  styles.assetChg,
                  up ? styles.textMint : styles.textRed,
                )}
              >
                {up ? "+" : ""}
                {change.toFixed(2)}%
              </div>
            </button>
          );
        })}
      </div>

      <label className={styles.leverageLabel}>Leverage</label>
      <div className={styles.leverageRow}>
        {LEVERAGE_OPTIONS.map((l) => (
          <button
            key={l}
            className={cn(
              styles.leverageButton,
              leverage === l
                ? isLong
                  ? styles.leverageButtonMintSelected
                  : styles.leverageButtonRedSelected
                : styles.leverageButtonUnselected,
            )}
            onClick={() => onLeverageChange(l)}
          >
            {l}×
          </button>
        ))}
      </div>

      <div
        className={cn(
          styles.summaryCard,
          isLong ? styles.summaryCardMint : styles.summaryCardRed,
        )}
      >
        <div
          className={cn(
            styles.summaryDot,
            isLong ? styles.summaryDotMint : styles.summaryDotRed,
          )}
        />
        <span className={styles.summaryName}>
          {getLtDisplayName(asset, leverage, direction)}
        </span>
        <span className={styles.summaryChg}>
          {chg >= 0 ? "+" : ""}
          {chg.toFixed(1)}% today
        </span>
      </div>

      <div className={styles.hlBadge}>
        <svg width="16" height="12" viewBox="0 0 36 24" fill="none">
          <path
            d="M14 2 L2 12 L14 22"
            stroke={COLORS.mint}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M22 2 L34 12 L22 22"
            stroke={COLORS.mint}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        powered by Hyperliquid perps
      </div>
    </div>
  );
}
