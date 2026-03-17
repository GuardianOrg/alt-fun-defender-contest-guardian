import { cn } from '@/utils/format';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'graduating' | 'graduating-short' | 'ath';
  className?: string;
}

export default function Badge({ children, variant = 'graduating', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'text-[10px] tracking-[0.1em] uppercase px-1.5 py-px rounded-sm border',
        variant === 'graduating' && 'text-mint border-mint/50 animate-badgep',
        variant === 'graduating-short' && 'text-red border-red/50 animate-badgep',
        variant === 'ath' &&
          'text-amber border-amber/30 bg-amber-bg animate-athg flex items-center gap-1.5 text-[12px] font-semibold px-2 py-[3px]',
        className,
      )}
    >
      {children}
    </span>
  );
}
