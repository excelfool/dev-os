import { cn } from '@/lib/utils/cn';

const TONES = {
  neutral: 'bg-grey-50 text-grey-600',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-100 text-warning-900',
  danger: 'bg-danger-50 text-danger-700',
  brand: 'bg-brand-50 text-brand-700',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-caption',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
