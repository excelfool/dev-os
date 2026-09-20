import { cn } from '@/lib/utils/cn';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-body text-grey-900', className)} {...props} />;
}
