import styles from "./HowItWorks.module.css";
import InfoCard from "./InfoCard/InfoCard";
import Hyperliquid from "../../../assets/how-it-works/Hyperliquid";
import Passive from "../../../assets/how-it-works/Passive";
import Rebalance from "../../../assets/how-it-works/Rebalance";
import Tokenise from "../../../assets/how-it-works/Tokenise";

interface HowItWorksCard {
  icon: React.ReactNode;
  text: string;
  focusedText: string;
}

const howItWorksCards: HowItWorksCard[] = [
  {
    icon: <Hyperliquid color="var(--primary-text)" />,
    text: "Backed by Hyperliquid's",
    focusedText: "deep liquidity",
  },
  {
    icon: <Rebalance color="var(--primary-text)" />,
    text: "Ultra efficient rebalancing through",
    focusedText: "HyperCore precompiles",
  },
  {
    icon: <Tokenise color="var(--primary-text)" />,
    text: "The benefits of perps with added",
    focusedText: "DeFi composability",
  },
  {
    icon: <Passive color="var(--primary-text)" />,
    text: "No active management",
    focusedText: "constant leveraged exposure",
  },
];

const HowItWorks = () => {
  return (
    <div className={styles.howItWorks}>
      {howItWorksCards.map((card, index) => (
        <InfoCard key={index} {...card} />
      ))}
    </div>
  );
};

export default HowItWorks;
