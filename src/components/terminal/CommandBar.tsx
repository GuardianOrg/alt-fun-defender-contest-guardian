import { useUIStore } from '@/stores/uiStore';
import type { TokenFilter } from '@/services/types';
import { cn } from '@/utils/format';
import styles from './CommandBar.module.css';

const TABS: { label: string; filter: TokenFilter }[] = [
  { label: 'TRENDING', filter: 'trending' },
  { label: 'NEW', filter: 'new' },
  { label: '⚡ LT MOVERS', filter: 'lt-movers' },
  { label: 'GRADUATING', filter: 'graduating' },
  { label: 'GRADUATED', filter: 'graduated' },
  { label: 'ALL', filter: 'all' },
];

interface Props {
  tokenCount: number;
}

export default function CommandBar({ tokenCount }: Props) {
  const activeFilter = useUIStore((s) => s.activeFilter);
  const setActiveFilter = useUIStore((s) => s.setActiveFilter);

  return (
    <div className={styles.bar}>
      <span className={styles.viewLabel}>VIEW</span>
      {TABS.map((tab) => (
        <button
          key={tab.filter}
          className={cn(
            styles.tab,
            activeFilter === tab.filter && styles.tabActive,
          )}
          onClick={() => setActiveFilter(tab.filter)}
        >
          {tab.label}
          {activeFilter === tab.filter && (
            <span className={styles.indicator} />
          )}
        </button>
      ))}
      <div className={styles.liveSection}>
        <div className={styles.liveDot} />
        <span className={styles.liveText}>{tokenCount} tokens live</span>
      </div>
    </div>
  );
}
