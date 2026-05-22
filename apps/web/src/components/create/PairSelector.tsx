import { getAssetDisplayName } from "@launchpad/shared";

import styles from "./PairSelector.module.css";
import StepHeader from "./StepHeader";
import hyperliquidLogo from "../../assets/Logos/hyperliquid.svg";
import { COLORS, rgba } from "../../config/colors";
import {
  useAssetChanges,
  useAvailableUnderlyingAssets,
} from "../../hooks/useAssets";
import { useLeverageOptions } from "../../hooks/useLeveragedTokens";
import { cn, formatPercent, getLtDisplayName } from "../../utils/format";
import AssetIcon from "../shared/AssetIcon";

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
  const availableAssets = useAvailableUnderlyingAssets();
  const isLong = direction === "long";
  const baseChg = assetChanges[asset];
  const leverageOptions = useLeverageOptions();
  const availableLeverages = useLeverageOptions(asset, isLong);
  const visibleLeverageOptions =
    asset === "HYPE" ? leverageOptions : leverageOptions.filter((l) => l !== 1);
  const chg =
    baseChg == null
      ? undefined
      : isLong
        ? baseChg * leverage
        : -baseChg * leverage;

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
            Token moves up when underlying pumps.
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
                fill={!isLong ? rgba(COLORS.red, 0.1) : rgba(COLORS.text, 0.03)}
              />
            </svg>
          </div>
          <div className={styles.cardDesc}>
            Token moves up when underlying dumps.
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
        {availableAssets.map((a) => {
          const change = assetChanges[a];
          const hasData = change != null;
          const up = hasData && change >= 0;
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
              title={a}
            >
              <AssetIcon
                asset={a}
                size={22}
                className={styles.assetLogo}
                monogramRatio={0.46}
              />
              <div className={styles.assetMeta}>
                <div className={styles.assetName}>{getAssetDisplayName(a)}</div>
                <div
                  className={cn(
                    styles.assetChg,
                    hasData
                      ? up
                        ? styles.textMint
                        : styles.textRed
                      : styles.textMuted,
                  )}
                >
                  {hasData ? formatPercent(change) : "—"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <label className={styles.leverageLabel}>Leverage</label>
      <div className={styles.leverageRow}>
        {visibleLeverageOptions.map((l) => {
          const disabled = !availableLeverages.includes(l);
          return (
            <button
              key={l}
              className={cn(
                styles.leverageButton,
                disabled
                  ? styles.leverageButtonDisabled
                  : leverage === l
                    ? isLong
                      ? styles.leverageButtonMintSelected
                      : styles.leverageButtonRedSelected
                    : styles.leverageButtonUnselected,
              )}
              disabled={disabled}
              onClick={() => onLeverageChange(l)}
              title={disabled ? "No contract-backed LT for this pair" : undefined}
            >
              {l}×
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          styles.summaryCard,
          isLong ? styles.summaryCardMint : styles.summaryCardRed,
        )}
      >
        <AssetIcon
          asset={asset}
          size={20}
          className={styles.summaryIcon}
          monogramRatio={0.46}
        />
        <span className={styles.summaryName}>
          {getLtDisplayName(asset, leverage, direction)}
        </span>
        <span className={styles.summaryChg}>
          {chg != null
            ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% today`
            : "— today"}
        </span>
      </div>

      <div className={styles.hlBadge}>
        <img
          src={hyperliquidLogo}
          alt=""
          aria-hidden="true"
          className={styles.hlBadgeLogo}
        />
        powered by Hyperliquid perps
      </div>
    </div>
  );
}
