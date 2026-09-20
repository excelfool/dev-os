'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-btn bg-grey-900 px-3 py-2 text-caption text-white',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/**
 * Info affordance for plain-English jargon (spec 16 §4 item 8). Radix opens on
 * focus as well as hover, which is the WCAG requirement — the trigger is a real
 * button, never a bare icon.
 */
export function InfoTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex items-center rounded-full text-grey-300 hover:text-grey-500"
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
