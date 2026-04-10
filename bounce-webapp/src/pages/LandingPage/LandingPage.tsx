import styles from "./LandingPage.module.css";
import Audits from "../../components/LandingPage/Audits/Audits";
import Hero from "../../components/LandingPage/Hero/Hero";
import HeroStats from "../../components/LandingPage/HeroStats/HeroStats";
import HowItWorks from "../../components/LandingPage/HowItWorks/HowItWorks";
import LandingPageFooter from "../../components/LandingPage/LandingPageFooter/LandingPageFooter";
import LiquidationPointsHero from "../../components/LandingPage/LiquidationPointsHero/LiquidationPointsHero";
import TokensTicker from "../../components/LandingPage/TokensTicker/TokensTicker";
import WhyBounce from "../../components/LandingPage/WhyBounce/WhyBounce";
import { useFeatureFlags } from "../../config/featureFlags";

const LandingPage = () => {
  const { liquidationScoreRoute } = useFeatureFlags();

  return (
    <div className={styles.landingPage}>
      <Hero />
      <TokensTicker />
      <HeroStats />
      {liquidationScoreRoute && <LiquidationPointsHero />}
      <WhyBounce />
      <HowItWorks />
      <Audits />
      <LandingPageFooter />
    </div>
  );
};

export default LandingPage;
