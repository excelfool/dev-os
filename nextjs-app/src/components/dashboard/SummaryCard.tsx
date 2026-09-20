import Link from 'next/link';
import { Card } from '@/components/ui/card';

export interface ContractSummary {
  total: number;
  nda: number;
  msa: number;
  thisMonth: number;
}

/** Labelled stats, never colour-coded (spec 09 §2). */
export function SummaryCard({ summary }: { summary: ContractSummary }) {
  const stats = [
    { label: 'Total contracts processed', value: String(summary.total) },
    { label: 'NDA / MSA', value: `${summary.nda} / ${summary.msa}` },
    { label: 'This month', value: String(summary.thisMonth) },
  ];

  return (
    <Card className="flex flex-col gap-subsection">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-h5 text-grey-900">Your reviews</h2>
        <Link
          href="/contracts/new"
          className="rounded-btn bg-brand-500 px-4 py-2 text-body text-white hover:bg-brand-600"
        >
          Review a Contract
        </Link>
      </div>
      <dl className="grid gap-subsection sm:grid-cols-3">
        {stats.map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="text-caption text-grey-400">{label}</dt>
            <dd className="text-h4 text-grey-900">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
