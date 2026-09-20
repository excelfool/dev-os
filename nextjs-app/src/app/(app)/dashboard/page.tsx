import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import {
  RecentContractsList,
  type RecentContract,
} from '@/components/dashboard/RecentContractsList';
import { ContractsTable } from '@/components/dashboard/ContractsTable';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'Dashboard · ContractIQ' };
export const dynamic = 'force-dynamic';

/**
 * Dashboard (spec 09 §1). Server Component; RLS scopes every read to the
 * caller. The summary and last-five are server-rendered; the sortable,
 * filterable table is a client island backed by GET /api/contracts.
 */
export default async function DashboardPage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).toISOString();

  const [totalResult, ndaResult, msaResult, thisMonthResult, recentResult] = await Promise.all([
    supabase.from('contracts').select('id', { count: 'exact', head: true }),
    supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('contract_type', 'NDA'),
    supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('contract_type', 'MSA'),
    supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart),
    supabase
      .from('contracts')
      .select('id, file_name, contract_type, status, review_completed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const summary = {
    total: totalResult.count ?? 0,
    nda: ndaResult.count ?? 0,
    msa: msaResult.count ?? 0,
    thisMonth: thisMonthResult.count ?? 0,
  };
  const recent = (recentResult.data ?? []) as RecentContract[];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-component px-4 py-12">
      <h1 className="text-h2 text-grey-900">Dashboard</h1>

      {summary.total === 0 ? (
        <EmptyState />
      ) : (
        <>
          <SummaryCard summary={summary} />
          <RecentContractsList contracts={recent} />
          <ContractsTable />
        </>
      )}
    </main>
  );
}
