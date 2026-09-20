import Link from 'next/link';
import { publicConfig } from '@/lib/utils/config';

/**
 * "Powered by OpenAI GPT-4o" attribution is required on every page
 * (PRD §11 Transparency, spec 16 §6). The status link is hidden when
 * NEXT_PUBLIC_STATUS_PAGE_URL is empty (spec 14 §2b).
 */
export function Footer() {
  return (
    <footer className="border-t border-grey-100 px-4 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
        <p className="text-caption text-grey-400">Powered by OpenAI GPT-4o</p>
        <nav className="flex items-center gap-4" aria-label="Legal and status">
          <Link href="/legal/terms" className="text-caption text-grey-500 underline">
            Terms
          </Link>
          <Link href="/legal/privacy" className="text-caption text-grey-500 underline">
            Privacy
          </Link>
          {publicConfig.statusPageUrl && (
            <a
              href={publicConfig.statusPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-caption text-grey-500 underline"
            >
              Service status
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
