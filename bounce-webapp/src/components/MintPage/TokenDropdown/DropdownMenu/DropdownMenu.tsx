import { useEffect, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { useDispatch, useSelector } from "react-redux";

import styles from "./DropdownMenu.module.css";
import DropdownTable from "./DropdownTable";
import { CloseIcon } from "../../../../assets/CloseIcon";
import { SearchIcon } from "../../../../assets/SearchIcon";
import { useIsMobile } from "../../../../hooks/useIsMobile";
import {
  selectIsTokenDropdownOpen,
  setIsTokenDropdownOpen,
} from "../../../../state/mintSlice";

const dropdownVariants = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

const mobileVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const DropdownMenu = () => {
  const isMobile = useIsMobile();
  const dispatch = useDispatch();

  const isDropdownOpen = useSelector(selectIsTokenDropdownOpen);

  const [searchValue, setSearchValue] = useState<string>("");
  const [sortKey, setSortKey] = useState<string>("symbol");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (isDropdownOpen && isMobile) {
      document.documentElement.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [isDropdownOpen, isMobile]);

  return (
    <>
      <AnimatePresence>
        {isDropdownOpen && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={isMobile ? mobileVariants : dropdownVariants}
            transition={{ duration: 0.25, ease: "easeOut" }}
            style={isMobile ? { zIndex: 300 } : { zIndex: 5 }}
          >
            <div className={styles.dropdown}>
              <button
                className={styles.header}
                onClick={() => dispatch(setIsTokenDropdownOpen(false))}
                data-testid="close-button"
              >
                <CloseIcon color="var(--primary-500-or-primary-300)" size={24} />
              </button>
              <div className={styles.searchContainer}>
                <SearchIcon color="var(--main)" size={20} />
                <input
                  type="text"
                  placeholder="Search by symbol"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                />
              </div>
              <DropdownTable
                searchValue={searchValue}
                sortKey={sortKey}
                sortDirection={sortDirection}
                setSortKey={setSortKey}
                setSortDirection={setSortDirection}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {isDropdownOpen && (
        <div
          className={`${styles.tokenDropdownBackground} ${
            isDropdownOpen ? styles.openBackground : ""
          }`}
          data-testid="dropdown-menu-background"
          onClick={() => dispatch(setIsTokenDropdownOpen(false))}
        />
      )}
    </>
  );
};

export default DropdownMenu;
