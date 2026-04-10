import { motion } from "framer-motion";
import { Link } from "react-router";

import styles from "./LiquidationPointsHero.module.css";
import { LIQUIDATION_SCORE_ROUTE } from "../../../app/routes";
import liquidationPointsHero from "../../../assets/liquidation-points/liquidation-score-hero.webp";
import Button from "../../Global/Buttons/Button";

const LiquidationPointsHero = () => {
  return (
    <div className={styles.hero}>
      <div className={styles.content}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h1 className={styles.header}>
            <span className={styles.bold}>Liquidation score</span>
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
        >
          <p className={styles.byline}>
            Claim rewards for your past liquidations
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
          className={styles.buttonWrapper}
        >
          <Link to={LIQUIDATION_SCORE_ROUTE}>
            <Button variant="primary" rounded size="large">
              Claim now
            </Button>
          </Link>
        </motion.div>
      </div>
      <div className={styles.illustrationContainer}>
        <img src={liquidationPointsHero} alt="" />
      </div>
    </div>
  );
};

export default LiquidationPointsHero;
