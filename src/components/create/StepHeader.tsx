import { cn } from '@/utils/format';

interface Props {
  step: number;
  title: string;
  subtitle: string;
  total?: number;
  active?: boolean;
}

export default function StepHeader({ step, title, subtitle, total = 3, active = true }: Props) {
  return (
    <div className="flex items-start gap-3.5 mb-5">
      {/* Step indicator */}
      <div className="flex flex-col items-center pt-0.5">
        <div
          className={cn(
            'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-colors shrink-0',
            active
              ? 'bg-mint/[0.12] border-mint text-mint shadow-inner-mint'
              : 'bg-bg-2 border-border text-txt-3',
          )}
        >
          {step}
        </div>
        {step < total && (
          <div className="w-px flex-1 min-h-[16px] bg-gradient-to-b from-border-2 to-transparent mt-1" />
        )}
      </div>

      {/* Title */}
      <div className="pt-0.5">
        <div className="font-display text-lg font-semibold text-txt tracking-[0.03em] leading-none">
          {title}
        </div>
        <div className="text-[13px] text-txt-3 mt-1.5">{subtitle}</div>
      </div>
    </div>
  );
}
