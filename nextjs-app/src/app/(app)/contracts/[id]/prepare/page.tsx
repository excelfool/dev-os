import { notFound, redirect } from 'next/navigation';
import { PrepareView } from '@/components/terms/PrepareView';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { termsFor } from '@/lib/ai/term-library';
import type { ContractType } from '@/types/domain';

export const metadata = { title: 'Prepare review · ContractIQ' };
export const dynamic = 'force-dynamic';

/**
 * Pre-processing preview (spec 05 §2). Server shell + client island.
 */
export default async function PreparePage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, file_name, contract_type, status, file_path')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (!contract) notFound();

  // Custom terms are a pre-processing-only concept.
  if (contract.status === 'completed') redirect(`/contracts/${contract.id}`);

  const { data: customTerms } = await supabase
    .from('custom_key_terms')
    .select('id, term_name')
    .eq('contract_id', contract.id)
    .order('created_at', { ascending: true });

  const contractType = contract.contract_type as ContractType;
  const standardTerms = termsFor(contractType);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-component px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-h2 text-grey-900">{contract.file_name}</h1>
        <p className="text-body text-grey-500">
          Review what we&apos;ll look for, add up to five terms of your own, then process.
        </p>
      </div>

      <PrepareView
        contractId={contract.id}
        contractType={contractType}
        standardTerms={standardTerms}
        standardTermNames={standardTerms.map((t) => t.term_name)}
        initialCustomTerms={customTerms ?? []}
        storageAvailable={contract.file_path !== null}
        startProcessing={contract.status === 'processing'}
      />
    </main>
  );
}
