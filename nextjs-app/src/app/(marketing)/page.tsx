import Link from 'next/link';
import { FileSearch, MapPin, Gauge, MessagesSquare } from 'lucide-react';

/**
 * Landing page (spec 03 §4). Static Server Component: no data fetch, no
 * Supabase call, cached at the CDN. Acceptance: Lighthouse performance ≥ 90.
 */
export const metadata = {
  title: 'ContractIQ — Understand any NDA or MSA in under 15 minutes',
};

const FEATURES = [
  {
    icon: FileSearch,
    title: 'Terms tailored to the contract type',
    body: 'Ten standard NDA terms, twelve for MSAs — the ones that actually decide your risk, not a generic checklist.',
  },
  {
    icon: MapPin,
    title: 'Every answer points at a page',
    body: 'Each extracted term carries the page number and the verbatim sentence it came from, so you can verify in one click.',
  },
  {
    icon: Gauge,
    title: 'A confidence score per term',
    body: 'You see how sure the model is. Anything below 50% is flagged for you to check, never quietly hidden.',
  },
  {
    icon: MessagesSquare,
    title: 'Chat grounded in your document',
    body: 'Ask in plain English. Answers come only from your contract, with a page citation — or an honest "I cannot find this".',
  },
];

export default function LandingPage() {
  return (
    <main>
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-subsection px-4 py-24 text-center">
        <h1 className="text-h1 text-grey-900">Understand any NDA or MSA in under 15 minutes</h1>
        <p className="max-w-xl text-body text-grey-500">
          Upload a contract and get the key terms extracted with page references, confidence scores
          and plain-English answers to whatever you ask about it.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-btn bg-brand-500 px-6 py-3 text-body text-white hover:bg-brand-600"
          >
            Get Started Free
          </Link>
          <Link
            href="/login"
            className="rounded-btn border border-grey-200 px-6 py-3 text-body text-grey-900 hover:bg-grey-25"
          >
            Sign In
          </Link>
        </div>
      </section>

      <section className="border-t border-grey-100 bg-grey-25 px-4 py-20">
        <div className="mx-auto grid max-w-5xl gap-component sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex flex-col gap-3 rounded-card bg-white p-6">
              <Icon aria-hidden="true" className="h-6 w-6 text-brand-500" />
              <h2 className="text-h5 text-grey-900">{title}</h2>
              <p className="text-body text-grey-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-body text-grey-500">
          ContractIQ is an AI-assisted review tool, not legal advice. It supports English-language,
          text-layer PDFs of NDAs and MSAs under US or UK law. Always verify critical terms with a
          qualified lawyer.
        </p>
      </section>
    </main>
  );
}
