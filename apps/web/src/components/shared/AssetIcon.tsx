import { useEffect, useState } from "react";

import {
  getAssetDisplayName,
  isSupportedUnderlying,
  type SupportedAsset,
} from "@launchpad/shared";

import styles from "./AssetIcon.module.css";
import BTC from "../../assets/Logos/BTC.svg";
import DOGE from "../../assets/Logos/doge.svg";
import ETH from "../../assets/Logos/ETH.svg";
import fartcoin from "../../assets/Logos/fartcoin.svg";
import HYPE from "../../assets/Logos/HYPE.svg";
import kPepe from "../../assets/Logos/kPEPE.svg";
import lit from "../../assets/Logos/lit.svg";
import near from "../../assets/Logos/near.svg";
import nvidia from "../../assets/Logos/nvidia.svg";
import pump from "../../assets/Logos/pump.svg";
import SOL from "../../assets/Logos/SOL.svg";
import SP500 from "../../assets/Logos/SP500.svg";
import spcx from "../../assets/Logos/spcx.svg";
import tesla from "../../assets/Logos/tesla.svg";
import xrp from "../../assets/Logos/xrp.svg";
import xyz_BB from "../../assets/Logos/xyz_BB.svg";
import xyz_BRENTOIL from "../../assets/Logos/xyz_BRENTOIL.svg";
import xyz_CBRS from "../../assets/Logos/xyz_CBRS.svg";
import xyz_CL from "../../assets/Logos/xyz_CL.svg";
import xyz_CXMT from "../../assets/Logos/xyz_CXMT.svg";
import xyz_GOLD from "../../assets/Logos/xyz_GOLD.svg";
import xyz_MU from "../../assets/Logos/xyz_MU.svg";
import xyz_SILVER from "../../assets/Logos/xyz_SILVER.svg";
import xyz_SKHX from "../../assets/Logos/xyz_SKHX.svg";
import xyz_XYZ100 from "../../assets/Logos/xyz_XYZ100.svg";
import zec from "../../assets/Logos/zec.svg";
import { cn } from "../../utils/format";

const ASSET_LOGOS: Record<SupportedAsset, string> = {
  HYPE,
  ETH,
  BTC,
  SOL,
  DOGE,
  ZEC: zec,
  kPEPE: kPepe,
  FARTCOIN: fartcoin,
  NEAR: near,
  LIT: lit,
  XRP: xrp,
  "xyz:CBRS": xyz_CBRS,
  "xyz:CL": xyz_CL,
  "xyz:BRENTOIL": xyz_BRENTOIL,
  "xyz:GOLD": xyz_GOLD,
  "xyz:SILVER": xyz_SILVER,
  "xyz:NVDA": nvidia,
  "xyz:TSLA": tesla,
  "xyz:SP500": SP500,
  "xyz:SPCX": spcx,
  "xyz:XYZ100": xyz_XYZ100,
  "xyz:BB": xyz_BB,
  "xyz:MU": xyz_MU,
  "xyz:SKHX": xyz_SKHX,
  "xyz:CXMT": xyz_CXMT,
  PUMP: pump,
};

interface Props {
  asset: string;
  size: number;
  className?: string;
  /** Monogram font size as a ratio of icon size. */
  monogramRatio?: number;
}

export default function AssetIcon({
  asset,
  size,
  className,
  monogramRatio = 0.52,
}: Props) {
  const [imgError, setImgError] = useState(false);
  // Reset logo failures when the same instance is reused for a different asset.
  useEffect(() => setImgError(false), [asset]);
  const logo = isSupportedUnderlying(asset) ? ASSET_LOGOS[asset] : undefined;
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

  // Two-letter monograms read better for assets like `kPEPE` and `XYZ100`.
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
