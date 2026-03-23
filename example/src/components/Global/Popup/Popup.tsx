import { useEffect } from "react";

import { AnimatePresence, motion, type Variants } from "framer-motion";

import styles from "./Popup.module.css";
import { CloseIcon } from "../../../assets/CloseIcon";

interface PopupProps {
  show: boolean;
  close: () => void;
  header?: string;
  children: React.ReactNode;
  maxWidth?: string;
  largeHeader?: boolean;
  noPadding?: boolean;
  noGap?: boolean;
}

const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25, ease: "easeInOut" } },
  exit: { opacity: 0, transition: { duration: 0.25, ease: "easeInOut" } },
};

const Popup = ({
  show,
  close,
  header,
  children,
  maxWidth,
  largeHeader,
  noPadding,
  noGap,
}: PopupProps) => {
  useEffect(() => {
    if (show) {
      document.documentElement.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [show]);

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          className={styles.container}
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.button
            className={styles.closeBackground}
            onClick={close}
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(10px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            transition={{
              duration: 0.25,
            }}
          />

          <motion.div
            className={`${styles.popupContent} ${
              noPadding ? styles.noPadding : ""
            }
            ${noGap ? styles.noGap : ""}`}
            style={{ maxWidth: maxWidth ? maxWidth : "" }}
            layout
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            exit={{ scaleY: 0, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 120,
              damping: 15,
            }}
          >
            {header && (
              <div className={styles.headerSection}>
                <h2
                  className={`${styles.header} ${
                    largeHeader ? styles.largeHeader : ""
                  }`}
                >
                  {header}
                </h2>
                <button
                  className={styles.closeButton}
                  onClick={close}
                  aria-label="Close modal"
                >
                  <CloseIcon
                    color="var(--primary-500-or-primary-300)"
                    size={24}
                  />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Popup;
