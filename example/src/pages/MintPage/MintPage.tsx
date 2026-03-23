import { useEffect } from "react";

import { motion } from "framer-motion";
import { useDispatch } from "react-redux";

import styles from "./MintPage.module.css";
import { useSyncTokenFromURL } from "./useMintPageRouting";
import BetaModal from "../../components/Global/BetaModal/BetaModal";
import CorePageContainer from "../../components/Global/CorePageContainer/CorePageContainer";
import CorePageTitle from "../../components/Global/CorePageTitle/CorePageTitle";
import DisabledComponent from "../../components/Global/DisabledComponent/DisabledComponent";
import ReferralBanner from "../../components/Global/ReferralBanner/ReferralBanner";
import Seo from "../../components/Global/Seo";
import ChartContainer from "../../components/MintPage/ChartContainer/ChartContainer";
import MintForm from "../../components/MintPage/MintForm/MintForm";
import ShareModal from "../../components/MintPage/Modals/ShareModal/ShareModal";
import Positions from "../../components/MintPage/Positions/Positions";
import { useAllowPageAccess } from "../../hooks/useAllowPageAccess";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  setGridOrListView,
  setIsTokenDropdownOpen,
} from "../../state/mintSlice";

const MintPage = () => {
  useSyncTokenFromURL();

  const allowPageAccess = useAllowPageAccess();
  const dispatch = useDispatch();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) {
      dispatch(setGridOrListView("grid"));
    }
    dispatch(setIsTokenDropdownOpen(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  return (
    <>
      <Seo
        title="Mint"
        description="Mint Page, mint leveraged tokens with Bounce."
      />
      <CorePageContainer wide>
        <DisabledComponent disableComponent={!allowPageAccess}>
          <BetaModal />
        </DisabledComponent>
        <ReferralBanner />
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ width: "100%" }}
        >
          <header className={styles.mobileTitleContainer}>
            <CorePageTitle title="Mint" titleHighlight="Leveraged Tokens" />
          </header>
          <div className={styles.interfaceContainer}>
            <ChartContainer />
            <motion.div
              className={styles.inputContainer}
              animate={{ height: "auto" }}
              transition={{ duration: 0.3 }}
            >
              <MintForm />
            </motion.div>
          </div>
        </motion.section>
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
          style={{ width: "100%" }}
        >
          <Positions />
        </motion.section>
        <ShareModal />
      </CorePageContainer>
    </>
  );
};

export default MintPage;
