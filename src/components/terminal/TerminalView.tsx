import { useTokens } from '@/hooks/useTokens';
import Sidebar from './Sidebar';
import CommandBar from './CommandBar';
import TokenTable from './TokenTable';
import RightPanel from './RightPanel';

export default function TerminalView() {
  const { data: tokens } = useTokens();

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <CommandBar tokenCount={tokens?.length ?? 0} />
        <TokenTable />
      </div>
      <RightPanel />
    </div>
  );
}
