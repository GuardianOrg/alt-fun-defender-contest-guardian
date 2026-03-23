import { AnimatePresence, motion } from "framer-motion";
import { Link, useLocation } from "react-router";

import styles from "./AnnouncementBar.module.css";
import { LIQUIDATION_POINTS_ROUTE, REGISTER_ROUTE } from "../../../app/routes";
import { useFeatureFlags } from "../../../config/featureFlags";
import { useIsUserBlocked } from "../../../hooks/useIsUserBlocked";
import { useUserHasRegistered } from "../../../hooks/useUserHasRegistered";

const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const AnnouncementBar = () => {
  const location = useLocation();
  const { hasRegistered } = useUserHasRegistered();
  const { liquidationPointsRoute } = useFeatureFlags();
  const { isUserBlocked } = useIsUserBlocked();

  const isMintOrPortfolio =
    location.pathname.startsWith("/mint/") ||
    location.pathname === "/portfolio";

  if (isMintOrPortfolio && isUserBlocked) {
    return (
      <div className={`${styles.announcementBar} ${styles.error}`}>
        Sorry, our services are not available in your region.{" "}
        <Link to="/terms-of-service#prohibited-uses" className={styles.link}>
          Find out more
        </Link>
      </div>
    );
  }

  /* liquidation points */
  if (
    location.pathname !== `/${LIQUIDATION_POINTS_ROUTE}` &&
    liquidationPointsRoute
  )
    return (
      <>
        <div className={`${styles.announcementBar} ${styles.primary}`}>
          Have you been liquidated on HyperLiquid? If so,{" "}
          <Link to={`/${LIQUIDATION_POINTS_ROUTE}`} className={styles.link}>
            claim your Liquidation Points
          </Link>{" "}
          now. 🥳
        </div>
      </>
    );

  /* beta launch */
  if (
    location.pathname !== `/${REGISTER_ROUTE}` &&
    !liquidationPointsRoute &&
    hasRegistered !== true
  )
    return (
      <>
        <div className={`${styles.announcementBar} ${styles.secondary}`}>
          <AnimatePresence mode="wait">
            {hasRegistered === false && (
              <motion.div
                key="unregistered"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                Bounce is currently in private beta,{" "}
                <Link to="/register" className={styles.link}>
                  register for access.
                </Link>
              </motion.div>
            )}

            {hasRegistered === null && (
              <div style={{ opacity: 0 }}>
                Bounce is currently in private beta, register for access.
              </div>
            )}
          </AnimatePresence>
        </div>
      </>
    );
};

export default AnnouncementBar;
