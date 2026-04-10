import { useEffect, useState } from "react";

import styles from "./ProgressBar.module.css";

type Props = {
  duration: number;
  isActive: boolean;
};

const ProgressBar = ({ duration, isActive }: Props) => {
  const [fill, setFill] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    setFill(1);
  }, [isActive]);

  return (
    <div className={styles.progressBar}>
      <div
        className={styles.progressFill}
        style={{
          transform: `scaleX(${fill})`,
          transformOrigin: "left",
          transition: isActive ? `transform ${duration}s linear` : "none",
        }}
      />
    </div>
  );
};
export default ProgressBar;
