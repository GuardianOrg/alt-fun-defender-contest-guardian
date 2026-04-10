import React from "react";

import { useDispatch } from "react-redux";

import styles from "./LongShortToggle.module.css";
import { LongArrow } from "../../../../assets/LongArrow";
import { ShortArrow } from "../../../../assets/ShortArrow";
import { setLongOrShort } from "../../../../state/mintSlice";

const LongShortToggle = ({
  selectedLongShort,
}: {
  selectedLongShort: "long" | "short";
}) => {
  const dispatch = useDispatch();

  return (
    <div className={styles.longShortButtons} data-testid="long-short-toggle">
      <button
        className={selectedLongShort === "long" ? styles.selected : ""}
        onClick={() => dispatch(setLongOrShort("long"))}
      >
        Long
        <LongArrow
          color={
            selectedLongShort === "long"
              ? "var(--primary-500-or-white)"
              : "transparent"
          }
          size={12}
        />
      </button>
      <button
        className={selectedLongShort === "short" ? styles.selected : ""}
        onClick={() => dispatch(setLongOrShort("short"))}
      >
        Short
        <ShortArrow
          color={
            selectedLongShort === "short"
              ? "var(--primary-500-or-white)"
              : "transparent"
          }
          size={12}
        />
      </button>
    </div>
  );
};

export default React.memo(LongShortToggle);
