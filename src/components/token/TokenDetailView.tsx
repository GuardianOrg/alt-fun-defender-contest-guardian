import { useParams } from 'react-router-dom';
import { useToken } from '@/hooks/useToken';
import { MOCK_TOKENS } from '@/services/mock/tokens';
import HeroSection from './HeroSection';
import Chart from './Chart';
import DecompPanel from './DecompPanel';
import ProgressBar from '@/components/shared/ProgressBar';
import TradePanel from './TradePanel';
import BottomTabs from './BottomTabs';
import { formatUsd } from '@/utils/format';
import { GRADUATION_THRESHOLD_USD } from '@/config/constants';

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
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
        <HeroSection token={displayToken} />
        <Chart token={displayToken} />
        <DecompPanel token={displayToken} />

        {/* Progress bar section */}
        <div className="shrink-0 px-4 py-[9px] pb-[11px] border-t border-border bg-bg-1">
          <div className="flex justify-between mb-1.5 text-[13px]">
            <span className="text-txt-2">
              {formatUsd(displayToken.curveRaisedUsd)} raised
            </span>
            <span className="text-amber font-semibold">
              {displayToken.curveFilled}% · graduating soon
            </span>
            <span className="text-txt-3">
              {formatUsd(GRADUATION_THRESHOLD_USD)} target
            </span>
          </div>
          <ProgressBar
            buyPercent={buyW}
            leveragePercent={levW}
            isShort={displayToken.direction === 'short'}
            isGraduating={displayToken.status === 'graduating'}
            size="md"
            showLegend
            buyUsd={formatUsd(displayToken.curveRaisedUsd * (buyW / displayToken.curveFilled))}
            leverageUsd={`+${formatUsd(displayToken.curveRaisedUsd * (levW / displayToken.curveFilled))}`}
          />
        </div>

        <BottomTabs token={displayToken} />
      </div>

      <TradePanel token={displayToken} />
    </div>
  );
}
