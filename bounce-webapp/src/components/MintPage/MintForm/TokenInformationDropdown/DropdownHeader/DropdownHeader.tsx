import React from "react";

import { motion } from "framer-motion";

import { Chevron } from "../../../../../assets/Chevron";
import styles from "../TokenInformationDropdown.module.css";

type HeaderProps = {
  leverageTokenSymbol: string;
  isOpen: boolean;
  toggleOpen: () => void;
};

const DropdownHeader = React.memo(
  ({ leverageTokenSymbol, isOpen, toggleOpen }: HeaderProps) => {
    return (
      <div
        className={styles.tokenInformationDropdownHeader}
        onClick={toggleOpen}
      >
        {leverageTokenSymbol} Details
        <motion.div
          animate={{ rotate: isOpen ? 0 : 180 }}
          transition={{ duration: 0.25 }}
          className={styles.chevron}
        >
          <Chevron color="var(--primary-500-or-white)" />
        </motion.div>
      </div>
    );
  },
);

export default DropdownHeader;
