import { useParams } from 'react-router-dom';
import { useToken } from '@/hooks/useToken';
import { MOCK_TOKENS } from '@/services/mock/tokens';
import HeroSection from './HeroSection';
import Chart from './Chart';
import ProgressBar from '@/components/shared/ProgressBar';
import TradePanel from './TradePanel';
import BottomTabs from './BottomTabs';
import { formatUsd } from '@/utils/format';
import { GRADUATION_THRESHOLD_USD } from '@/config/constants';
import styles from './TokenDetailView.module.css';

export default function TokenDetailView() {
  const { address } = useParams<{ address: string }>();
  const { data: token } = useToken(address);

  const displayToken = token ?? MOCK_TOKENS[0];

  const buyW = Math.round(
    displayToken.curveFilled -
      (displayToken.leverageBoost > 0
        ? (displayToken.leverageBoost / displayToken.change24h) * displayToken.curveFilled
        : 0),
  );
  const levW = displayToken.curveFilled - buyW;

  return (
    <div className={styles.wrapper}>
      <div className={styles.leftPanel}>
        <HeroSection token={displayToken} />
        <Chart token={displayToken} />

        <div className={styles.curveStrip}>
          <span className={styles.curveLabel}>curve</span>
          <span className={styles.curveRaised}>
            {formatUsd(displayToken.curveRaisedUsd)}
          </span>
          <div className={styles.progressWrapper}>
            <ProgressBar
              buyPercent={buyW}
              leveragePercent={levW}
              isShort={displayToken.direction === 'short'}
              isGraduating={displayToken.status === 'graduating'}
              size="sm"
            />
          </div>
          <span className={styles.curveThreshold}>
            {formatUsd(GRADUATION_THRESHOLD_USD)}
          </span>
          {displayToken.status === 'graduating' && (
            <span className={styles.graduatingBadge}>
              graduating
            </span>
          )}
        </div>

        <BottomTabs token={displayToken} />
      </div>

      <TradePanel token={displayToken} />
    </div>
  );
}
