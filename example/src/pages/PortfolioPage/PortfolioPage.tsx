import { motion } from "framer-motion";

import styles from "./PortfolioPage.module.css";
import BetaModal from "../../components/Global/BetaModal/BetaModal";
import CorePageContainer from "../../components/Global/CorePageContainer/CorePageContainer";
import CorePageTitle from "../../components/Global/CorePageTitle/CorePageTitle";
import DisabledComponent from "../../components/Global/DisabledComponent/DisabledComponent";
import ReferralBanner from "../../components/Global/ReferralBanner/ReferralBanner";
import Seo from "../../components/Global/Seo";
import ShareModal from "../../components/MintPage/Modals/ShareModal/ShareModal";
import PortfolioCards from "../../components/PortfolioPage/PortfolioCards/PortfolioCards";
import PortfolioMainSection from "../../components/PortfolioPage/PortfolioMainSection/PortfolioMainSection";
import { useAllowPageAccess } from "../../hooks/useAllowPageAccess";

const PortfolioPage = () => {
  const allowPageAccess = useAllowPageAccess();

  return (
    <>
      <Seo title="Portfolio" description="Your portfolio page." />
      <CorePageContainer>
        <DisabledComponent disableComponent={!allowPageAccess}>
          <BetaModal />
        </DisabledComponent>
        <ReferralBanner />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ width: "100%" }}
        >
          <CorePageTitle title="Portfolio" />
        </motion.div>
        <div className={styles.portfolioContainer}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
          >
            <PortfolioCards />
          </motion.div>
          <PortfolioMainSection />
        </div>
        <ShareModal />
      </CorePageContainer>
    </>
  );
};

export default PortfolioPage;
