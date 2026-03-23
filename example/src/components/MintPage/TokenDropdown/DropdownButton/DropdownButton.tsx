import { motion } from "framer-motion";
import { useSelector, useDispatch } from "react-redux";

import styles from "./DropdownButton.module.css";
import { SmallTriangleDown } from "../../../../assets/SmallTriangleDown";
import {
  selectIsTokenDropdownOpen,
  selectSelectedTargetAsset,
  setIsTokenDropdownOpen,
} from "../../../../state/mintSlice";
import DropdownMenu from "../DropdownMenu/DropdownMenu";

const DropdownButton = () => {
  const isTokenDropdownOpen = useSelector(selectIsTokenDropdownOpen);
  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);
  const dispatch = useDispatch();

  return (
    <div className={styles.dropdownContainer}>
      <button
        className={`${styles.dropdownButton} ${
          isTokenDropdownOpen ? styles.open : ""
        }`}
        onClick={() => dispatch(setIsTokenDropdownOpen(!isTokenDropdownOpen))}
        aria-expanded={isTokenDropdownOpen}
        aria-haspopup="listbox"
      >
        <span className={styles.coinCell}>
          <img
            src={selectedTargetAsset.image}
            alt={`${selectedTargetAsset.symbol} logo`}
            width={20}
          />
          {selectedTargetAsset.symbol}
        </span>
        <motion.div
          animate={{ rotate: isTokenDropdownOpen ? 180 : 0 }}
          transition={{ duration: 0.25 }}
          style={{
            display: "inline-block",
            transformOrigin: "center",
            transformBox: "fill-box",
          }}
        >
          <SmallTriangleDown color="var(--main)" />
        </motion.div>
      </button>
      <DropdownMenu />
    </div>
  );
};

export default DropdownButton;
