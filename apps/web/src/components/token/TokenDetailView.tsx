import { useParams } from "react-router";

import AdminPanel from "./AdminPanel";
import BottomTabs from "./BottomTabs";
import Chart from "./Chart";
import HeroSection from "./HeroSection";
import HeroSectionSkeleton from "./HeroSectionSkeleton";
import styles from "./TokenDetailView.module.css";
import TokenInfoStrip from "./TokenInfoStrip";
import TokenInfoStripSkeleton from "./TokenInfoStripSkeleton";
import TradePanel from "./TradePanel";
import TradePanelSkeleton from "./TradePanelSkeleton";
import { useGraduationFeed } from "../../hooks/useGraduationFeed";
import { useGraduationThreshold } from "../../hooks/useGraduationThreshold";
import { useTrackRecentlyViewed } from "../../hooks/useRecentlyViewed";
import { useToken } from "../../hooks/useToken";
import { useTokenLiveFeed } from "../../hooks/useTokenLiveFeed";
import { formatUsd, formatUsdOrDash } from "../../utils/format";
import ErrorBoundary from "../shared/ErrorBoundary";
import ProgressBar from "../shared/ProgressBar";

export default function TokenDetailView() {
  const { address } = useParams<{ address: string }>();
  const { data: token, isError } = useToken(address);
  // Live owner-tunable threshold; fall back to the compile-time default
  // while the RPC read is in flight so the curve strip never flashes "$0".
  const { data: graduationThresholdUsd, fallback: thresholdFallback } =
    useGraduationThreshold();
  useTrackRecentlyViewed(token?.address);
  // Auto-transition Curve → Graduating → Graduated when the indexer fires
  // a `graduation` WS event for this token.
  useGraduationFeed(address);
  // Keep the curve strip (progress + raised USD) and the rest of the
  // token-detail metadata (mcap, price, 24h change/volume) live as
  // trades land on-chain — throttled invalidation of the `useToken`
  // query off the `trade` WS channel. See issue #643.
  useTokenLiveFeed(address);

  if (isError) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Token not found</div>
      </div>
    );
  }

  // Unreachable under normal routing — the `:address` route param is
  // mandatory, so React Router would 404 before ever rendering this view
  // without one. Kept as a defensive fallback that surfaces a clear
  // not-found message (no `role="status"` / `aria-live`; nothing is
  // loading here).
  if (!address) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Invalid token address</div>
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
  //
  // Graduated tokens collapse to a single solid 100% fill (no organic/boost
  // split — per apps/web/AGENTS.md "hide the split entirely") so the bar
  // visually reads as "complete" alongside the `graduated` badge below.
  const isGraduated = token?.status === "graduated";
  const filled = isGraduated ? 100 : (token?.curveFilled ?? 0);
  const organic = isGraduated ? 100 : (token?.organicFilled ?? filled);
  const buyW = Math.min(organic, filled);
  const levW = Math.max(filled - buyW, 0);

  // Keep a single, stable render tree across loading → loaded so the Chart
  // fiber (and its in-flight `fetchChart` request) is preserved when
  // `useToken` resolves. Sections that depend on token metadata render a
  // placeholder until `token` is available; the chart only needs `address`
  // (the `:address` route param) and mounts immediately so its fetch runs
  // in parallel with the metadata request rather than sequentially after.
  //
  // `aria-busy` flips off as soon as `useToken` resolves. Screen readers
  // pause polite announcements while the wrapper is busy, so the swap
  // from skeleton → real content lands as one settled update rather than
  // a series of half-formed reads of each section as it materialises.
  return (
    <div className={styles.wrapper} aria-busy={token ? undefined : true}>
      <div className={styles.leftPanel}>
        {token ? <HeroSection token={token} /> : <HeroSectionSkeleton />}

        {token && (
          <ErrorBoundary
            // Moderation surface is non-essential — render-time errors here
            // (e.g. session-signature flow misbehaving) must not blow up
            // the entire token detail page for admins. Pinned directly
            // under `HeroSection` (issue #607) so allowlisted wallets can
            // hide a token without scrolling past the chart / info strip /
            // bottom tabs to reach the moderation controls.
            fallback={null}
          >
            <AdminPanel token={token} />
          </ErrorBoundary>
        )}

        <ErrorBoundary
          fallback={
            <div className={styles.errorFallback}>Chart failed to load</div>
          }
        >
          <Chart address={address} token={token ?? null} />
        </ErrorBoundary>

        {token && (
          <div className={styles.curveStrip}>
            <span className={styles.curveLabel}>curve</span>
            {/* `curveRaisedUsd` is `null` post-graduation by API contract
             *  (the on-chain curve no longer holds the LT reserve that
             *  drives the figure — see `apps/api/AGENTS.md`). Rendering
             *  `formatUsdOrDash(null)` would leave a stray `—` floating
             *  to the left of the bar; the right side already drops the
             *  `$threshold` for the `graduated` badge in the same
             *  branch, so we mirror that on the left and hide the
             *  raised figure entirely once the token has graduated. */}
            {!isGraduated && (
              <span className={styles.curveRaised}>
                {formatUsdOrDash(token.curveRaisedUsd)}
              </span>
            )}
            <div className={styles.progressWrapper}>
              <ProgressBar
                buyPercent={buyW}
                leveragePercent={levW}
                isShort={token.direction === "short"}
                isGraduating={token.status === "graduating"}
                isGraduated={isGraduated}
                size="sm"
              />
            </div>
            {isGraduated ? (
              <span className={styles.graduatedBadge}>graduated</span>
            ) : (
              <>
                <span className={styles.curveThreshold}>
                  {formatUsd(graduationThresholdUsd ?? thresholdFallback)}
                </span>
                {token.status === "graduating" && (
                  <span className={styles.graduatingBadge}>graduating</span>
                )}
              </>
            )}
          </div>
        )}

        {token?.description && (
          <p className={styles.description}>{token.description}</p>
        )}

        {token ? <TokenInfoStrip token={token} /> : <TokenInfoStripSkeleton />}

        {token && (
          <ErrorBoundary
            fallback={
              <div className={styles.errorFallback}>
                Failed to load tab content
              </div>
            }
          >
            <BottomTabs token={token} />
          </ErrorBoundary>
        )}
      </div>

      {token ? (
        <ErrorBoundary
          fallback={
            <div className={styles.errorFallback}>
              Trade panel failed to load
            </div>
          }
        >
          <TradePanel token={token} />
        </ErrorBoundary>
      ) : (
        <TradePanelSkeleton />
      )}
    </div>
  );
}
