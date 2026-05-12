import styles from "./TradePanel.module.css";
import { useCopyState } from "../../hooks/useCopyState";
import { cn } from "../../utils/format";
import Chip from "../shared/Chip";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function TradePanelFooter({ token }: Props) {
  const { copied, copy: copyCA } = useCopyState();

  return (
    <div className={styles.footer}>
      <div className={styles.footerLeft}>
        <Chip
          success={copied}
          onClick={() => copyCA(token.address)}
          className={styles.footerCaChip}
          aria-label={`Copy contract address ${token.address}`}
        >
          {copied
            ? "✓ copied"
            : `${token.address.slice(0, 6)}…${token.address.slice(-4)}`}
        </Chip>
        <span className={styles.footerDot}>·</span>
        <span className={styles.footerLt}>{token.ltName}</span>
      </div>
      <span
        className={cn(
          styles.footerStatus,
          token.status === "graduating"
            ? styles.footerStatusGraduating
            : styles.footerStatusDefault,
        )}
      >
        {token.status}
        {token.status === "graduating" ? " ⚡" : ""}
      </span>
    </div>
  );
}
