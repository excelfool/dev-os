import Link from 'next/link';

/** Zero-contracts empty state (spec 09 §2) — copy is verbatim from spec 16 §6. */
export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-subsection rounded-card border border-dashed border-grey-100 px-6 py-20 text-center">
      <p className="text-h5 text-grey-900">
        No contracts reviewed yet — upload your first contract to begin
      </p>
      <p className="max-w-md text-body text-grey-500">
        Upload an NDA or MSA and ContractIQ will pull out the key terms with page references and
        confidence scores.
      </p>
      <Link
        href="/contracts/new"
        className="rounded-btn bg-brand-500 px-6 py-3 text-body text-white hover:bg-brand-600"
      >
        Review a Contract
      </Link>
    </div>
  );
}
