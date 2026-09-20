import { notFound, redirect } from 'next/navigation';
import { ResultsView } from '@/components/terms/ResultsView';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getServerConfig } from '@/lib/utils/server-config';
import type { Contract, KeyTerm } from '@/types/domain';

export const metadata = { title: 'Review · ContractIQ' };
export const dynamic = 'force-dynamic';

export default async function ResultsPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: contract } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (!contract) notFound();
  if (contract.status === 'uploaded') redirect(`/contracts/${contract.id}/prepare`);

  // Touches the 90-day retention anchor (A-10).
  await supabase
    .from('contracts')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', contract.id)
    .eq('user_id', user.id);

  const { data: feedback } = await supabase
    .from('user_feedback')
    .select('rating, survey_accuracy')
    .eq('contract_id', contract.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: keyTerms } = await supabase
    .from('key_terms')
    .select('*')
    .eq('contract_id', contract.id)
    .order('display_rank', { ascending: true })
    .order('term_name', { ascending: true });

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-subsection px-4 py-8">
      <h1 className="text-h3 text-grey-900">{contract.file_name}</h1>
      <ResultsView
        contract={contract as Contract}
        keyTerms={(keyTerms ?? []) as KeyTerm[]}
        userId={user.id}
        calibrationWarningActive={getServerConfig().CALIBRATION_WARNING_ACTIVE}
        initialFeedback={feedback ?? null}
      />
    </main>
  );
}
