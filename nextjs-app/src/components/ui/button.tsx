import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-btn text-body transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-500 text-white hover:bg-brand-600',
        secondary: 'border border-grey-200 bg-white text-grey-900 hover:bg-grey-25',
        ghost: 'text-grey-600 hover:bg-grey-50',
        destructive: 'bg-danger-600 text-white hover:bg-danger-700',
      },
      size: {
        sm: 'px-3 py-1.5 text-caption',
        md: 'px-4 py-2.5',
        lg: 'px-6 py-3',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
