import { AnimatePresence, motion } from "framer-motion";
import { useDispatch, useSelector } from "react-redux";

import styles from "./Toast.module.css";
import { CloseIcon } from "../../../assets/CloseIcon";
import JellyLoader from "../../../assets/JellyLoader";
import { clearToast, selectToast } from "../../../state/toastSlice";

const toastVariants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    y: -20,
  },
};

const Toast = () => {
  const toast = useSelector(selectToast);
  const dispatch = useDispatch();

  const iconColor = {
    success: "var(--success-300)",
    error: "var(--error-300)",
    warning: "var(--warning-300)",
    info: "var(--info-300)",
  };

  return (
    <AnimatePresence mode="wait">
      {toast.isOpen && toast.content && (
        <motion.div
          key={toast.id}
          className={`${styles.toast} ${styles[toast.variant]}`}
          variants={toastVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.25, ease: "easeInOut" }}
          role="status"
          aria-live="polite"
        >
          {toast.loadingIcon && (
            <JellyLoader color={iconColor[toast.variant]} size={2.4} />
          )}
          {toast.content}
          <button
            onClick={() => dispatch(clearToast())}
            aria-label="Close notification"
          >
            <CloseIcon color={iconColor[toast.variant]} size={24} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Toast;
