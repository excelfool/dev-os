import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-input border border-grey-200 bg-white px-3 py-2.5 text-body text-grey-900',
        'placeholder:text-grey-300 aria-[invalid=true]:border-danger-600',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
