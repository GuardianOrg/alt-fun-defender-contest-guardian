import { useTokens } from '@/hooks/useTokens';
import Sidebar from './Sidebar';
import CommandBar from './CommandBar';
import TokenTable from './TokenTable';
import RightPanel from './RightPanel';
import styles from './TerminalView.module.css';

export default function TerminalView() {
  const { data: tokens } = useTokens();

  return (
    <div className={styles.wrapper}>
      <Sidebar />
      <div className={styles.mainContent}>
        <CommandBar tokenCount={tokens?.length ?? 0} />
        <TokenTable />
      </div>
      <RightPanel />
    </div>
  );
}
