import { useSelector } from "react-redux";

import TokenRow from "./TokenRow";
import styles from "./TokenTable.module.css";
import { useTokensByDirection } from "../../hooks/useTokens";
import { selectActiveFilter } from "../../state/uiSlice";
import { cn } from "../../utils/format";

function ColumnHeader({
  direction,
  count,
}: {
  direction: "long" | "short";
  count: number;
}) {
  const isLong = direction === "long";
  return (
    <div className={styles.columnHeader}>
      <div
        className={cn(
          styles.directionBadge,
          isLong ? styles.directionLong : styles.directionShort,
        )}
      >
        {isLong ? "\u25B2 LONG" : "\u25BC SHORT"}
      </div>
      <div className={styles.countCell}>{count} tokens</div>
      <div className={styles.sortActive}>TRENDING</div>
      <div className={styles.sortItem}>NEWEST</div>
      <div className={styles.sortItem}>PROGRESS</div>
    </div>
  );
}

function TableHead() {
  return (
    <div className={styles.tableHead}>
      {["", "TOKEN", "24H", "PROGRESS", "MCAP"].map((h, i) => (
        <div
          key={h || i}
          className={cn(
            styles.headCell,
            (i === 2 || i === 4) && styles.headCellRight,
          )}
        >
          {h}
        </div>
      ))}
    </div>
  );
}

export default function TokenTable() {
  const activeFilter = useSelector(selectActiveFilter);
  const { data: longTokens } = useTokensByDirection("long", activeFilter);
  const { data: shortTokens } = useTokensByDirection("short", activeFilter);

  return (
    <div className={styles.wrapper}>
      {/* LONG column */}
      <div className={styles.column}>
        <ColumnHeader direction="long" count={longTokens?.length ?? 0} />
        <TableHead />
        <div className={styles.scrollArea}>
          {longTokens?.map((t) => (
            <TokenRow key={t.address} token={t} />
          ))}
        </div>
      </div>

      {/* SHORT column */}
      <div className={styles.columnShort}>
        <ColumnHeader direction="short" count={shortTokens?.length ?? 0} />
        <TableHead />
        <div className={styles.scrollArea}>
          {shortTokens?.map((t) => (
            <TokenRow key={t.address} token={t} />
          ))}
        </div>
      </div>
    </div>
  );
}
