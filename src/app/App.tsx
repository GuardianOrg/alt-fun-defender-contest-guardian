import { Routes, Route, useLocation } from 'react-router-dom';
import Header from '@/components/layout/Header';
import AssetTape from '@/components/layout/AssetTape';
import SearchModal from '@/components/layout/SearchModal';
import EarningsPanel from '@/components/layout/EarningsPanel';
import PasswordGate from '@/components/layout/PasswordGate';
import LeverageBanner from '@/components/terminal/LeverageBanner';
import TerminalView from '@/components/terminal/TerminalView';
import TokenDetailView from '@/components/token/TokenDetailView';
import CreateView from '@/components/create/CreateView';
import { cn } from '@/utils/format';

export default function App() {
  const location = useLocation();
  const isTokenPage = location.pathname.startsWith('/token/');

  return (
    <PasswordGate>
      <div
        className={cn(
          'h-full flex flex-col',
          isTokenPage && 'animate-ambpulse',
        )}
      >
        <LeverageBanner />
        <Header />
        <AssetTape />
        <Routes>
          <Route path="/" element={<TerminalView />} />
          <Route path="/token/:address" element={<TokenDetailView />} />
          <Route path="/create" element={<CreateView />} />
        </Routes>
        <SearchModal />
        <EarningsPanel />
      </div>
    </PasswordGate>
  );
}
