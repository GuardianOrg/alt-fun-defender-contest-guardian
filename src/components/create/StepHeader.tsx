import { cn } from '@/utils/format';
import styles from './StepHeader.module.css';

interface Props {
  step: number;
  title: string;
  subtitle: string;
  total?: number;
  active?: boolean;
}

export default function StepHeader({ step, title, subtitle, total = 3, active = true }: Props) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.indicator}>
        <div
          className={cn(
            styles.stepCircle,
            active ? styles.stepCircleActive : styles.stepCircleInactive,
          )}
        >
          {step}
        </div>
        {step < total && <div className={styles.connector} />}
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>
    </div>
  );
}
