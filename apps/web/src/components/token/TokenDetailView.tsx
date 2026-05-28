import { useEffect, useState } from "react";

import { DEFAULT_GRADUATION_THRESHOLD_USD } from "@launchpad/shared";
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
import { useIsMobile } from "../../hooks/useIsMobile";
import { useTrackRecentlyViewed } from "../../hooks/useRecentlyViewed";
import { useToken } from "../../hooks/useToken";
import { useTokenLiveFeed } from "../../hooks/useTokenLiveFeed";
import { cn, formatUsd, formatUsdOrDash } from "../../utils/format";
import NotFound from "../layout/NotFound";
import Button from "../shared/Button";
import ErrorBoundary from "../shared/ErrorBoundary";
import Modal from "../shared/Modal";
import ProgressBar from "../shared/ProgressBar";
import Skeleton from "../shared/Skeleton";

export default function TokenDetailView() {
  const { address } = useParams<{ address: string }>();
  const {
    data: token,
    isError,
    isFetched,
    isCachedFallback,
  } = useToken(address);
  // Track mobile in JS so the trade panel mounts only once: inline or in the modal.
  const isMobile = useIsMobile();
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  // Do not strand the mobile modal after resizing back to desktop.
  useEffect(() => {
    if (!isMobile && tradeModalOpen) setTradeModalOpen(false);
  }, [isMobile, tradeModalOpen]);
  useTrackRecentlyViewed(token?.address);
  useGraduationFeed(address);
  useTokenLiveFeed(address);

  // Defensive fallback; normal routing requires `:address`.
  if (!address) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Invalid token address</div>
      </div>
    );
  }

  if (!token && isFetched) {
    return <NotFound title="Token not found" />;
  }

  // API pre-clamps organic/boost buckets; degraded or graduated states collapse to a simple fill.
  const isGraduated = token?.status === "graduated";
  const isUsingCachedFallback = !!isCachedFallback || (isError && !!token);
  const filled = isGraduated ? 100 : (token?.curveFilled ?? 0);
  const organic = isGraduated ? 100 : (token?.organicFilled ?? filled);
  const buyW = Math.min(organic, filled);
  const levW = Math.max(filled - buyW, 0);

  // Keep Chart mounted while metadata resolves so its fetch runs in parallel.
  return (
    <div
      className={styles.tokenDetailViewWrapper}
      aria-busy={token ? undefined : true}
    >
      <div className={styles.leftPanel}>
        {/* Hidden tokens are visible here only to holders, so frame this as a sell-out notice. */}
        {token?.isHidden && (
          <div
            className={styles.hiddenBanner}
            role="status"
            data-testid="hidden-token-banner"
          >
            <div className={styles.hiddenBannerTitle}>
              Token removed for policy violation
            </div>
            <div className={styles.hiddenBannerBody}>
              An admin has removed {token.ticker} from the public listings.
              Buying is disabled; you can still sell your remaining{" "}
              {token.ticker} balance from the trade panel.
            </div>
          </div>
        )}

        {token ? <HeroSection token={token} /> : <HeroSectionSkeleton />}

        {token && (
          <ErrorBoundary
            // Admin moderation must not take down the token detail page.
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

        <div className={styles.metadataStack}>
          {token && !isUsingCachedFallback && (
            <div className={styles.curveStrip}>
              <span className={cn(styles.curveLabel, "ui-subheading")}>
                Curve
              </span>
              <div className={styles.curveBody}>
                {/* Hide raised USD after graduation; the curve reserve no longer exists. */}
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
                      {formatUsd(DEFAULT_GRADUATION_THRESHOLD_USD)}
                    </span>
                    {token.status === "graduating" && (
                      <span className={styles.graduatingBadge}>graduating</span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {token && isUsingCachedFallback && (
            <div className={styles.curveStrip}>
              <span className={cn(styles.curveLabel, "ui-subheading")}>
                Curve
              </span>
              <div className={styles.curveBody}>
                {isGraduated ? (
                  <>
                    <div className={styles.progressWrapper}>
                      <ProgressBar
                        buyPercent={100}
                        leveragePercent={0}
                        isShort={token.direction === "short"}
                        isGraduated
                        size="sm"
                      />
                    </div>
                    <span className={styles.graduatedBadge}>graduated</span>
                  </>
                ) : (
                  <>
                    <Skeleton width="4.5rem" height="1rem" />
                    <div className={styles.progressWrapper}>
                      <Skeleton shape="block" width="100%" height="0.5rem" />
                    </div>
                    <Skeleton width="4rem" height="1rem" />
                  </>
                )}
              </div>
            </div>
          )}

          {token?.description && (
            <section className={styles.descriptionSection}>
              <span className={cn(styles.descriptionLabel, "ui-subheading")}>
                Description
              </span>
              <p className={styles.description}>{token.description}</p>
            </section>
          )}

          {token ? (
            <TokenInfoStrip
              token={token}
              liveDataPending={isUsingCachedFallback}
            />
          ) : (
            <TokenInfoStripSkeleton />
          )}
        </div>

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

      {/* Render the trade panel in exactly one place to avoid duplicate subscriptions/form state. */}
      {!isMobile &&
        (token ? (
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
        ))}

      {/* Wait for metadata so the mobile CTA can show the real ticker. */}
      {isMobile && token && (
        <div className={styles.mobileTradeBar}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => setTradeModalOpen(true)}
          >
            Trade {token.ticker}
          </Button>
        </div>
      )}

      {isMobile && token && tradeModalOpen && (
        <Modal
          onClose={() => setTradeModalOpen(false)}
          panelClassName={styles.tradeModalPanel}
          hideCloseButton
        >
          <ErrorBoundary
            fallback={
              <div className={styles.errorFallback}>
                Trade panel failed to load
              </div>
            }
          >
            <TradePanel token={token} chromeless />
          </ErrorBoundary>
        </Modal>
      )}
    </div>
  );
}
