import { useMemo } from "react";

import { getAssetDisplayName } from "@launchpad/shared";

import styles from "./PairSelector.module.css";
import StepHeader from "./StepHeader";
import hyperliquidLogo from "../../assets/Logos/hyperliquid.svg";
import { COLORS, rgba } from "../../config/colors";
import { UNDERLYING_ASSETS, LEVERAGE_OPTIONS } from "../../config/constants";
import { useAssetChanges, useLiveUnderlyings } from "../../hooks/useAssets";
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
  // Hide underlying-asset buttons whose backing LTs aren't live on
  // BounceTech's UI yet (issue #621). `useLiveUnderlyings` returns
  // `undefined` while loading or after a failed fetch, in which case we
  // fall back to "show every supported asset" — same fail-open policy as
  // `apps/api/src/lib/lt-availability.ts`. We always keep the currently
  // selected asset in the list to avoid the UI tearing a button out from
  // under the user mid-flow (e.g. if BounceTech un-publishes an asset
  // between page load and the live-set refresh).
  const liveUnderlyings = useLiveUnderlyings();
  const visibleAssets = useMemo(() => {
    if (!liveUnderlyings) return UNDERLYING_ASSETS;
    return UNDERLYING_ASSETS.filter(
      (a) => liveUnderlyings.has(a) || a === asset,
    );
  }, [liveUnderlyings, asset]);
  const isLong = direction === "long";
  const baseChg = assetChanges[asset];
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
                fill={!isLong ? rgba(COLORS.red, 0.1) : rgba(COLORS.text, 0.03)}
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
        {visibleAssets.map((a) => {
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
