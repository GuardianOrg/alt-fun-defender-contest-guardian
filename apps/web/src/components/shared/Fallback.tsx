import type { ReactNode } from "react";

import styles from "./Fallback.module.css";

interface Props {
  code?: string;
  title: string;
  message?: ReactNode;
  actions: ReactNode;
  details?: string;
}

export default function Fallback({
  code,
  title,
  message,
  actions,
  details,
}: Props) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.panel} role="alert">
        {code ? <div className={styles.code}>{code}</div> : null}
        <div className={styles.title}>{title}</div>
        {message ? <p className={styles.message}>{message}</p> : null}
        <div className={styles.actions}>{actions}</div>
        {details ? (
          <details className={styles.details}>
            <summary>Error details</summary>
            <pre className={styles.detailsBody}>{details}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
