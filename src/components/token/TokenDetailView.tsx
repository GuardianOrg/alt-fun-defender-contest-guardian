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

        {/* Compact bonding curve strip */}
        <div className="shrink-0 flex items-center gap-3 px-4 h-9 border-t border-border bg-bg-1">
          <span className="text-[11px] tracking-[0.06em] uppercase text-txt-4 shrink-0">curve</span>
          <span className="text-[13px] text-txt-2 font-medium tabular-nums shrink-0">
            {formatUsd(displayToken.curveRaisedUsd)}
          </span>
          <div className="flex-1">
            <ProgressBar
              buyPercent={buyW}
              leveragePercent={levW}
              isShort={displayToken.direction === 'short'}
              isGraduating={displayToken.status === 'graduating'}
              size="sm"
            />
          </div>
          <span className="text-[13px] text-txt-3 tabular-nums shrink-0">
            {formatUsd(GRADUATION_THRESHOLD_USD)}
          </span>
          {displayToken.status === 'graduating' && (
            <span className="text-[11px] text-amber font-semibold tracking-[0.04em] animate-badgep shrink-0">
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
