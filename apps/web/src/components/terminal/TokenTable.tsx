import { useSelector } from "react-redux";

import TokenRow from "./TokenRow";
import styles from "./TokenTable.module.css";
import { useTokens } from "../../hooks/useTokens";
import { selectActiveFilter } from "../../state/uiSlice";

function TableHead() {
  return (
    <div className={styles.tableHead}>
      {[
        "ALTCOIN",
        "UNDERLYING",
        "DIRECTION / LEVERAGE",
        "24H CHANGE",
        "PROGRESS",
        "MCAP",
      ].map((h) => (
        <div key={h} className={styles.headCell}>
          {h}
        </div>
      ))}
    </div>
  );
}

export default function TokenTable() {
  const activeFilter = useSelector(selectActiveFilter);
  const { data: tokens } = useTokens(activeFilter);

  return (
    <div className={styles.wrapper}>
      <div className={styles.column}>
        <div className={styles.scrollArea}>
          <div className={styles.tableInner}>
            <TableHead />
            {tokens?.map((t) => (
              <TokenRow key={t.address} token={t} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
