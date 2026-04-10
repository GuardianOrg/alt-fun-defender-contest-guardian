import { useState } from "react";

import { motion, AnimatePresence } from "framer-motion";
import { Link, useRouteError } from "react-router";

import styles from "./ErrorPage.module.css";
import Button from "../../components/Global/Buttons/Button";
import Seo from "../../components/Global/Seo";

const ErrorPage = () => {
  const error = useRouteError();
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error occurred";

  const [isDetailsVisible, setIsDetailsVisible] = useState(false);

  const toggleDetails = () => setIsDetailsVisible((prev) => !prev);

  return (
    <>
      <Seo
        title="Error Encountered"
        description="There is an issue with this page, please try again later."
      />

      <div className={styles.errorPage}>
        <div className={styles.errorContainer}>
          <div className={styles.errorContent}>
            <h1 className={styles.errorTitle}>Oops!</h1>
            <motion.h2
              className={styles.errorSubtitle}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
            >
              Something went wrong
            </motion.h2>

            <motion.div
              className={styles.errorInfo}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.4 }}
            >
              <p className={styles.errorMessage}>
                You can report this issue on our{" "}
                <a
                  href="https://discord.gg/T8DvHhCrGV"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discord
                </a>
                .
              </p>

              <div className={styles.detailsWrapper}>
                <div className={styles.toggleDetails} onClick={toggleDetails}>
                  {isDetailsVisible ? "Hide details" : "Show details"}
                </div>

                <AnimatePresence>
                  {isDetailsVisible && (
                    <motion.p
                      className={styles.detailsText}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{
                        opacity: 0,
                        height: 0,
                        transition: { opacity: { duration: 0 } },
                      }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                    >
                      {errorMessage}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
          >
            <Link to="/">
              <Button variant="primary" size="large">
                Return Home
              </Button>
            </Link>
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default ErrorPage;
