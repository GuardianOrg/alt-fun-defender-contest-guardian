import styles from "./TradePanel.module.css";
import { useCopyState } from "../../hooks/useCopyState";
import { cn } from "../../utils/format";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function TradePanelFooter({ token }: Props) {
  const { copied, copy: copyCA } = useCopyState();

  return (
    <div className={styles.footer}>
      <div className={styles.footerLeft}>
        <a className={styles.footerCa} onClick={() => copyCA(token.address)}>
          {copied
            ? "✓ copied"
            : `${token.address.slice(0, 6)}…${token.address.slice(-4)}`}
        </a>
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
