import { useDispatch, useSelector } from "react-redux";

import styles from "./CommandBar.module.css";
import { selectActiveFilter, setActiveFilter } from "../../state/uiSlice";
import { cn } from "../../utils/format";

import type { TokenFilter } from "../../services/types";

const TABS: { label: string; filter: TokenFilter }[] = [
  { label: "TRENDING", filter: "trending" },
  { label: "NEW", filter: "new" },
  { label: "LT MOVERS", filter: "lt-movers" },
  { label: "GRADUATING", filter: "graduating" },
  { label: "GRADUATED", filter: "graduated" },
];

interface Props {
  tokenCount: number;
}

export default function CommandBar({ tokenCount }: Props) {
  const activeFilter = useSelector(selectActiveFilter);
  const dispatch = useDispatch();

  return (
    <div className={styles.bar}>
      {TABS.map((tab) => (
        <button
          key={tab.filter}
          className={cn(
            styles.tab,
            activeFilter === tab.filter && styles.tabActive,
          )}
          onClick={() => dispatch(setActiveFilter(tab.filter))}
        >
          {tab.label}
          {activeFilter === tab.filter && <span className={styles.indicator} />}
        </button>
      ))}
      <div className={styles.liveSection}>
        <div className={styles.liveDot} />
        <span className={styles.liveText}>{tokenCount} tokens live</span>
      </div>
    </div>
  );
}
