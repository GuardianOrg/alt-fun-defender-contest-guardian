import { useEffect, useState } from "react";

import { getAssetDisplayName } from "@launchpad/shared";

import styles from "./AssetIcon.module.css";
import BTC from "../../assets/Logos/BTC.svg";
import DOGE from "../../assets/Logos/doge.svg";
import ETH from "../../assets/Logos/ETH.svg";
import HYPE from "../../assets/Logos/HYPE.svg";
import kPepe from "../../assets/Logos/kPEPE.svg";
import nvidia from "../../assets/Logos/nvidia.svg";
import paxg from "../../assets/Logos/paxg.svg";
import SOL from "../../assets/Logos/SOL.svg";
import SP500 from "../../assets/Logos/SP500.svg";
import zec from "../../assets/Logos/zec.svg";
import { cn } from "../../utils/format";
import xyz_BRENTOIL from "../../assets/Logos/xyz_BRENTOIL.svg";
import xyz_GOLD from "../../assets/Logos/xyz_GOLD.svg";
import xyz_SILVER from "../../assets/Logos/xyz_SILVER.svg";
import xyz_XYZ100 from "../../assets/Logos/xyz_XYZ100.svg";

/**
 * Map of `targetAsset` (the BounceTech LT field) → bundled SVG logo.
 *
 * Keep both the namespaced (`xyz:SP500`) and unprefixed lookups in mind:
 * we always look up against the raw asset symbol so storage and display
 * stay aligned. Anything missing here falls through to the monogram
 * fallback so we don't block adding new assets on having art ready.
 */
const ASSET_LOGOS: Record<string, string> = {
  HYPE,
  ETH,
  BTC,
  SOL,
  PAXG: paxg,
  ZEC: zec,
  "xyz:SP500": SP500,
  "xyz:NVDA": nvidia,
  DOGE,
  kPEPE: kPepe,
  "xyz:BRENTOIL": xyz_BRENTOIL,
  "xyz:GOLD": xyz_GOLD,
  "xyz:SILVER": xyz_SILVER,
  "xyz:XYZ100": xyz_XYZ100,
  "xyz:CL": xyz_BRENTOIL,
};

interface Props {
  asset: string;
  size: number;
  className?: string;
  /**
   * Adapt monogram font sizing for tiny icons. Defaults to ~52% of `size`,
   * which reads well from ~14px upwards.
   */
  monogramRatio?: number;
}

/**
 * Render a circular icon for an underlying asset. Uses a bundled SVG logo
 * when available; otherwise falls back to a circular monogram (first 1–2
 * characters of the display name, with the `xyz:` prefix stripped).
 *
 * The fallback exists so we can roll out new BounceTech LTs without
 * blocking on a designer providing a new SVG — once art lands, just add
 * the entry to `ASSET_LOGOS` above.
 */
export default function AssetIcon({
  asset,
  size,
  className,
  monogramRatio = 0.52,
}: Props) {
  const [imgError, setImgError] = useState(false);
  // Reset the error flag when the asset prop changes so a previous logo
  // failure doesn't permanently force the new asset onto the monogram
  // fallback (matters when the same `<AssetIcon>` instance is reused
  // across rows / list virtualisation).
  useEffect(() => setImgError(false), [asset]);
  const logo = ASSET_LOGOS[asset];
  const display = getAssetDisplayName(asset);
  const dimensionStyle = { width: size, height: size };

  if (logo && !imgError) {
    return (
      <img
        src={logo}
        alt=""
        className={cn(styles.icon, className)}
        style={dimensionStyle}
        onError={() => setImgError(true)}
      />
    );
  }

  // Two-letter monograms read better than a single letter for assets like
  // `kPEPE` and `XYZ100`; uppercase keeps the optical weight consistent
  // alongside the polished SVGs.
  const monogram = display.length > 1 ? display.slice(0, 2) : display;
  return (
    <span
      className={cn(styles.fallback, className)}
      style={{ ...dimensionStyle, fontSize: Math.round(size * monogramRatio) }}
      aria-hidden="true"
      title={asset}
    >
      {monogram}
    </span>
  );
}
