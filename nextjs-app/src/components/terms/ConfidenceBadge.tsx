'use client';

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { confidenceBand, CONFIDENCE_BAND_STYLES, LOW_CONFIDENCE_TOOLTIP } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

const BAND_ICONS = {
  high: CheckCircle2,
  medium: Info,
  low: AlertTriangle,
} as const;

/**
 * Confidence is conveyed by icon + text + colour in every surface — never
 * colour alone (spec 16 §4 item 1). A `< 50` term carries a non-dismissible
 * tooltip and is NEVER hidden (FR-11).
 */
export function ConfidenceBadge({ score }: { score: number }) {
  const band = confidenceBand(score);
  const styles = CONFIDENCE_BAND_STYLES[band];
  const Icon = BAND_ICONS[band];

  const badge = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-caption',
        styles.background,
        styles.text,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {styles.label(score)}
    </span>
  );

  if (band !== 'low') return badge;

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={LOW_CONFIDENCE_TOOLTIP}>
            {badge}
          </button>
        </TooltipTrigger>
        <TooltipContent>{LOW_CONFIDENCE_TOOLTIP}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
