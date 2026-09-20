import Link from 'next/link';
import { Footer } from '@/components/layout/Footer';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-grey-100 px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-h5 text-grey-900">
            ContractIQ
          </Link>
          <nav className="flex items-center gap-4" aria-label="Account">
            <Link href="/login" className="text-body text-grey-600">
              Sign In
            </Link>
            <Link
              href="/signup"
              className="rounded-btn bg-brand-500 px-4 py-2 text-body text-white hover:bg-brand-600"
            >
              Get Started Free
            </Link>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
