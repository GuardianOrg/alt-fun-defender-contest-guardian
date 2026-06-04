import type { ReactNode } from "react";

import styles from "./TokenDataTable.module.css";
import { cn } from "../../utils/format";

type ColumnVariant = "default" | "small" | "wide";

export interface TokenDataTableColumn {
  key: string;
  label: ReactNode;
  variant?: ColumnVariant;
}

interface Props {
  columns: TokenDataTableColumn[];
  children: ReactNode;
  ariaBusy?: boolean;
}

export default function TokenDataTable({
  columns,
  children,
  ariaBusy,
}: Props) {
  return (
    <table className={styles.table} aria-busy={ariaBusy || undefined}>
      <thead className={cn(styles.head, "terminal-table-head")}>
        <tr className={styles.headerRow}>
          {columns.map((column, idx) => (
            <th
              key={column.key}
              className={cn(
                styles.headerCell,
                column.variant === "small" && styles.headerCellSmall,
                column.variant === "wide" && styles.headerCellWide,
                idx === 0 && styles.headerCellFirst,
              )}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
