import { cn } from '@/utils/format';
import styles from './Badge.module.css';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'graduating' | 'graduating-short' | 'ath';
  className?: string;
}

export default function Badge({ children, variant = 'graduating', className }: BadgeProps) {
  return (
    <span
      className={cn(
        styles.badge,
        variant === 'graduating' && styles.graduating,
        variant === 'graduating-short' && styles.graduatingShort,
        variant === 'ath' && styles.ath,
        className,
      )}
    >
      {children}
    </span>
  );
}
