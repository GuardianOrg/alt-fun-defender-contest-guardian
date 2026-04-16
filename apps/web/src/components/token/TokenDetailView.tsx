import { useParams } from "react-router";

import BottomTabs from "./BottomTabs";
import Chart from "./Chart";
import HeroSection from "./HeroSection";
import styles from "./TokenDetailView.module.css";
import TradePanel from "./TradePanel";
import { GRADUATION_THRESHOLD_USD } from "../../config/constants";
import { useToken } from "../../hooks/useToken";
import { formatUsd } from "../../utils/format";
import ErrorBoundary from "../shared/ErrorBoundary";
import ProgressBar from "../shared/ProgressBar";

export default function TokenDetailView() {
  const { address } = useParams<{ address: string }>();
  const { data: token, isLoading, isError } = useToken(address);

  if (isLoading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Loading token...</div>
      </div>
    );
  }

  if (isError || !token) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Token not found</div>
      </div>
    );
  }

  // Progress bar split between "bought" progress and "leverage-driven" progress.
  // TODO: once `leverageBoost` is populated from on-chain data (currently always
  // 0), restore the (leverageBoost / change24h) × curveFilled apportionment,
  // pulling change24h from `useTokenMarketStats` so "unknown" doesn't render
  // as 0. For now the whole bar is buy-driven — matches the old silent-zero
  // behaviour without misusing `Token.change24h`.
  const buyW = Math.round(token.curveFilled);
  const levW = token.curveFilled - buyW;

  return (
    <div className={styles.wrapper}>
      <div className={styles.leftPanel}>
        <HeroSection token={token} />
        <ErrorBoundary
          fallback={
            <div className={styles.errorFallback}>Chart failed to load</div>
          }
        >
          <Chart token={token} />
        </ErrorBoundary>

        {token.status !== "graduated" && (
          <div className={styles.curveStrip}>
            <span className={styles.curveLabel}>curve</span>
            <span className={styles.curveRaised}>
              {formatUsd(token.curveRaisedUsd)}
            </span>
            <div className={styles.progressWrapper}>
              <ProgressBar
                buyPercent={buyW}
                leveragePercent={levW}
                isShort={token.direction === "short"}
                isGraduating={token.status === "graduating"}
                size="sm"
              />
            </div>
            <span className={styles.curveThreshold}>
              {formatUsd(GRADUATION_THRESHOLD_USD)}
            </span>
            {token.status === "graduating" && (
              <span className={styles.graduatingBadge}>graduating</span>
            )}
          </div>
        )}

        <ErrorBoundary
          fallback={
            <div className={styles.errorFallback}>
              Failed to load tab content
            </div>
          }
        >
          <BottomTabs token={token} />
        </ErrorBoundary>
      </div>

      <ErrorBoundary
        fallback={
          <div className={styles.errorFallback}>Trade panel failed to load</div>
        }
      >
        <TradePanel token={token} />
      </ErrorBoundary>
    </div>
  );
}
