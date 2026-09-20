import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-subsection px-4 text-center">
      <h1 className="text-h3 text-grey-900">We couldn&apos;t find that page.</h1>
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="text-body text-brand-500 underline">
          Go to dashboard
        </Link>
        <Link href="/" className="text-body text-brand-500 underline">
          Back to home
        </Link>
      </div>
    </main>
  );
}
