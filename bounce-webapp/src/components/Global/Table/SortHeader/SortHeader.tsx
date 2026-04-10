import { motion } from "framer-motion";

import styles from "./SortHeader.module.css";
import { Chevron } from "../../../../assets/Chevron";
import InfoTooltip from "../../Tooltip/InfoTooltip";

interface SortHeaderProps {
  title: string;
  headerActive: boolean;
  sortDirection: "asc" | "desc";
  handleSort: () => void;
  divClassname?: keyof typeof styles;
  tooltip?: string;
}

const SortHeader = ({
  title,
  headerActive,
  sortDirection,
  handleSort,
  divClassname,
  tooltip,
}: SortHeaderProps) => {
  return (
    <th onClick={() => handleSort()}>
      <div
        className={[styles.sortHeader, divClassname && styles[divClassname]]
          .filter(Boolean)
          .join(" ")}
      >
        {title}
        {tooltip && (
          <div className={styles.tooltip}>
            <InfoTooltip content={tooltip} />
          </div>
        )}
        <motion.span
          animate={{
            rotate: sortDirection === "asc" ? 180 : 0,
          }}
          transition={{ duration: 0.25 }}
          className={`${styles.chevron} ${
            headerActive ? styles.chevronActive : ""
          }`}
        >
          <Chevron color="var(--primary-500-or-white)" />
        </motion.span>
      </div>
    </th>
  );
};

export default SortHeader;
