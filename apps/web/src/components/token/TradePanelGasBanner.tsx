import styles from "./TradePanel.module.css";
import { RELAY_BRIDGE_HYPE_URL } from "../../config/relay";
import { HYPEFUEL_DOCS_URL } from "../../services/hypefuel";
import { formatUsd } from "../../utils/format";

import type { HypeFuelQuotePreview } from "../../services/hypefuel";

interface Props {
  preview: HypeFuelQuotePreview | null;
  haircutFromUsd: number | null;
  haircutToUsd: number | null;
  error: string | null;
  showRelayFallback: boolean;
}

export default function TradePanelGasBanner({
  preview,
  haircutFromUsd,
  haircutToUsd,
  error,
  showRelayFallback,
}: Props) {
  return (
    <div className={styles.pausedBanner} role="status">
      <div className={styles.pausedBannerTitle}>Need HYPE for gas</div>
      <div className={styles.pausedBannerBody}>
        HyperEVM bills gas in HYPE. Spend $1.00 USDC via HypeFuel
        {preview
          ? ` to get about ${preview.hypeOutFormatted} HYPE (fee $${preview.feeUsdcFormatted}).`
          : " to get HYPE (fee shown after quote)."}{" "}
        You sign a message, not a transaction, so this step costs no gas.
      </div>
      {haircutFromUsd !== null && haircutToUsd !== null && (
        <div className={styles.pausedBannerBody}>
          $1.00 of your USDC covers gas, so this buy becomes{" "}
          {formatUsd(haircutToUsd)} instead of {formatUsd(haircutFromUsd)}.
        </div>
      )}
      {error && <div className={styles.pausedBannerBody}>{error}</div>}
      {showRelayFallback && (
        <a
          className={styles.pausedBannerLink}
          href={RELAY_BRIDGE_HYPE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Bridge HYPE instead →
        </a>
      )}
      <a
        className={styles.pausedBannerLink}
        href={HYPEFUEL_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        How HypeFuel works →
      </a>
    </div>
  );
}
