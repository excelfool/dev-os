import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';

export function AuthCard({
  title,
  subtitle,
  footerPrompt,
  footerLinkHref,
  footerLinkLabel,
  children,
}: {
  title: string;
  subtitle: string;
  footerPrompt: string;
  footerLinkHref: string;
  footerLinkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-subsection px-4 py-12">
      <div className="text-center">
        <Link href="/" className="text-h5 text-grey-900">
          ContractIQ
        </Link>
      </div>
      <Card className="flex flex-col gap-subsection">
        <div className="flex flex-col gap-2">
          <CardTitle>{title}</CardTitle>
          <p className="text-body text-grey-500">{subtitle}</p>
        </div>
        {children}
      </Card>
      <p className="text-center text-body text-grey-500">
        {footerPrompt}{' '}
        <Link href={footerLinkHref} className="text-brand-500 underline">
          {footerLinkLabel}
        </Link>
      </p>
    </main>
  );
}
