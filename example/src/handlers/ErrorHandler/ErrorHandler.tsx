import { useState } from "react";

import { motion, AnimatePresence } from "framer-motion";
import { useDispatch, useSelector } from "react-redux";

import styles from "./ErrorHandler.module.css";
import { TriangleDown } from "../../assets/TriangleDown";
import Popup from "../../components/Global/Popup/Popup";
import { selectError, setError } from "../../state/errorSlice";

const ErrorHandler = () => {
  const dispatch = useDispatch();
  const error = useSelector(selectError);

  const [showDetails, setShowDetails] = useState(false);

  if (!error) return null;

  return (
    <Popup
      header="Error Encountered"
      show={!!error}
      close={() => dispatch(setError(null))}
    >
      <p className={styles.text}>{error?.message}</p>

      {error?.details && (
        <div className={styles.detailsContainer}>
          <AnimatePresence initial={false}>
            {showDetails && (
              <motion.p
                className={styles.details}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{
                  opacity: 0,
                  height: 0,
                  transition: { opacity: { duration: 0 } },
                }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                {error.details}
              </motion.p>
            )}
          </AnimatePresence>
          <div
            className={styles.toggleDetailsAccordion}
            onClick={() => setShowDetails((prev) => !prev)}
          >
            {showDetails ? "Less details" : "More details"}
            <motion.div
              animate={{ rotate: showDetails ? 180 : 0 }}
              transition={{ duration: 0.25 }}
            >
              {TriangleDown("var(--grey-500-or-white)")}
            </motion.div>
          </div>
        </div>
      )}
    </Popup>
  );
};

export default ErrorHandler;
