import type { ReactNode, MouseEvent } from "react";

import styles from "./ModalOverlay.module.css";

interface Props {
  children: ReactNode;
  onClose: () => void;
}

export default function ModalOverlay({ children, onClose }: Props) {
  const handleClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleClick}>
      {children}
    </div>
  );
}
