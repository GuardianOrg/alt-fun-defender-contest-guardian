import { useParams } from "react-router";

import BottomTabs from "./BottomTabs";
import Chart from "./Chart";
import HeroSection from "./HeroSection";
import styles from "./TokenDetailView.module.css";
import TradePanel from "./TradePanel";
import { useGraduationFeed } from "../../hooks/useGraduationFeed";
import { useGraduationThreshold } from "../../hooks/useGraduationThreshold";
import { useTrackRecentlyViewed } from "../../hooks/useRecentlyViewed";
import { useToken } from "../../hooks/useToken";
import { formatUsd } from "../../utils/format";
import ErrorBoundary from "../shared/ErrorBoundary";
import ProgressBar from "../shared/ProgressBar";

export default function TokenDetailView() {
  const { address } = useParams<{ address: string }>();
  const { data: token, isLoading, isError } = useToken(address);
  // Live owner-tunable threshold; fall back to the compile-time default
  // while the RPC read is in flight so the curve strip never flashes "$0".
  const { data: graduationThresholdUsd, fallback: thresholdFallback } =
    useGraduationThreshold();
  useTrackRecentlyViewed(token?.address);
  // Auto-transition Curve → Graduating → Graduated when the indexer fires
  // a `graduation` WS event for this token.
  useGraduationFeed(address);

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

  // Progress bar split between organic USDC buys and LT price appreciation.
  // The API pre-clamps both buckets so they sum to `curveFilled` and never
  // go negative (a dropping LT shows as all-organic, no boost). When the
  // indexer/BounceTech is degraded `organicFilled` is null — fall back to
  // a single solid fill so we don't imply "all boost, no organic".
  // A null `curveFilled` (degraded) renders as an empty bar; numeric
  // display sites use `formatCurveFilled` to show `—` instead of `0%`.
  const filled = token.curveFilled ?? 0;
  const organic = token.organicFilled ?? filled;
  const buyW = Math.min(organic, filled);
  const levW = Math.max(filled - buyW, 0);

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
              {formatUsd(graduationThresholdUsd ?? thresholdFallback)}
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
