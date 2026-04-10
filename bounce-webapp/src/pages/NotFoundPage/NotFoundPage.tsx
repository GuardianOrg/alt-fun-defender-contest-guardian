import { motion } from "framer-motion";
import CountUp from "react-countup";
import { Link } from "react-router";

import styles from "./NotFoundPage.module.css";
import Button from "../../components/Global/Buttons/Button";
import Seo from "../../components/Global/Seo";

const NotFoundPage = () => {
  return (
    <>
      <Seo
        title="Page Not Found"
        description="The page you're looking for doesn't exist or has been moved."
      />
      <div className={styles.notFoundPage}>
        <h1 className={styles.notFoundTitle}>
          <span>
            <CountUp end={404} duration={1.5} />
          </span>
        </h1>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
        >
          <h2 className={styles.notFoundSubtitle}>Page Not Found</h2>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.4 }}
        >
          <p className={styles.notFoundText}>
            The page you're looking for doesn't exist or has been moved.
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
        >
          <Link to="/">
            <Button variant="primary" size="large">
              Go Home
            </Button>
          </Link>
        </motion.div>
      </div>
    </>
  );
};

export default NotFoundPage;
