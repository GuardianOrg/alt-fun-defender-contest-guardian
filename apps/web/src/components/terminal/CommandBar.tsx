import { useDispatch, useSelector } from "react-redux";

import styles from "./CommandBar.module.css";
import TableFilters from "./TableFilters";
import { selectActiveFilter, setActiveFilter } from "../../state/uiSlice";
import { cn } from "../../utils/format";

import type { TokenFilter } from "../../services/types";

const TABS: { label: string; filter: TokenFilter }[] = [
  { label: "TRENDING", filter: "trending" },
  { label: "NEW", filter: "new" },
  { label: "GRADUATED", filter: "graduated" },
];

export default function CommandBar() {
  const activeFilter = useSelector(selectActiveFilter);
  const dispatch = useDispatch();

  return (
    <div className={styles.bar}>
      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.filter}
            className={cn(
              styles.tab,
              activeFilter === tab.filter && styles.tabActive,
            )}
            onClick={() => dispatch(setActiveFilter(tab.filter))}
          >
            {/* `data-label` feeds the phantom-bold `::after` in
             * `CommandBar.module.css` that reserves the active-state
             * (font-weight: 700) width on every tab. Without it the
             * tabs grow when activated and shove their siblings around
             * by a pixel or two — see the rule for details. */}
            <span className={styles.label} data-label={tab.label}>
              {tab.label}
            </span>
            {activeFilter === tab.filter && (
              <span className={styles.indicator} />
            )}
          </button>
        ))}
      </div>
      <TableFilters />
    </div>
  );
}
