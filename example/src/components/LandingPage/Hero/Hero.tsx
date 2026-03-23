import { motion } from "framer-motion";
import { Link } from "react-router";

import styles from "./Hero.module.css";
import { MINT_ROUTE, REGISTER_ROUTE } from "../../../app/routes";
import heroIllustration from "../../../assets/bounce-illustration-2.svg";
import { useUserHasRegistered } from "../../../hooks/useUserHasRegistered";
import Button from "../../Global/Buttons/Button";

const Hero = () => {
  const { hasRegistered } = useUserHasRegistered();

  return (
    <div className={styles.hero}>
      <img
        className={styles.illustration}
        src={heroIllustration}
        alt="Hero Illustration"
      />
      <div className={styles.content}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h2 className={styles.subheader}>Private beta now live</h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
        >
          <h1 className={styles.header}>
            Leveraged tokens
            <br /> <span className={styles.bold}>for all of finance</span>
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
          className={styles.buttonWrapper}
        >
          <Link to={hasRegistered ? MINT_ROUTE : REGISTER_ROUTE}>
            <Button variant="primary" rounded size="large">
              {hasRegistered ? "Get started" : "Register"}
            </Button>
          </Link>
        </motion.div>
      </div>
    </div>
  );
};

export default Hero;
