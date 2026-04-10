import { useState } from "react";

import { motion } from "framer-motion";
import { Link } from "react-router";

import styles from "./PortfolioMainSection.module.css";
import ReferralCard from "./ReferralCard/ReferralCard";
import TableButtons from "./TableButtons/TableButtons";
import { MINT_ROUTE } from "../../../app/routes";
import useBounceAccount from "../../../web3/views/useBounceAccount";
import useUsersLeveragedTokens from "../../../web3/views/useUsersLeveragedTokens";
import Button from "../../Global/Buttons/Button";
import PositionList from "../../Global/PositionList/PositionList";
import TradesList from "../../Global/TradesList/TradesList";
import ZeroStateContainer from "../../Global/ZeroStateContainer/ZeroStateContainer";
import RedeemModal from "../../MintPage/Modals/RedeemModal/RedeemModalContainer";

const PortfolioMainSection = () => {
  const { isConnected } = useBounceAccount();
  const positions = useUsersLeveragedTokens();

  const [selectedTab, setSelectedTab] = useState<
    "openPositions" | "tradingHistory"
  >("openPositions");

  let content;

  if (!isConnected) {
    content = (
      <ZeroStateContainer>
        <p>Connect your wallet to view your positions</p>
        <Button variant="primary" addressRequired />
      </ZeroStateContainer>
    );
  } else if (selectedTab === "openPositions") {
    content =
      positions && positions.length > 0 ? (
        <PositionList positions={positions} />
      ) : (
        <ZeroStateContainer>
          <p>You have no active Leverage Token positions.</p>
          <Link to={`/${MINT_ROUTE}`}>
            <Button variant="primary">Mint a Leverage Token</Button>
          </Link>
        </ZeroStateContainer>
      );
  } else if (selectedTab === "tradingHistory") {
    content = <TradesList />;
  } else {
    content = null;
  }

  return (
    <div className={styles.mainSection}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
      >
        <TableButtons
          isConnected={isConnected}
          selectedTab={selectedTab}
          positionsLength={positions?.length || 0}
          setSelectedTab={setSelectedTab}
        />
        {content}
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
      >
        <ReferralCard />
      </motion.div>
      <RedeemModal />
    </div>
  );
};

export default PortfolioMainSection;
