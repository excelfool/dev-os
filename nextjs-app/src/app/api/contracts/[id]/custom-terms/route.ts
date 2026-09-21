import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError, appErrorWithMessage } from '@/lib/errors/app-error';
import { ERROR_DEFINITIONS, ALREADY_PROCESSED_CUSTOM_TERMS_SUFFIX } from '@/lib/errors/error-codes';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { customTermSchema } from '@/lib/validation/custom-term.schema';
import { isStandardTerm } from '@/lib/ai/term-library';
import { getServerConfig } from '@/lib/utils/server-config';
import type { ContractType } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const alreadyProcessed = () =>
  appErrorWithMessage(
    'ALREADY_PROCESSED',
    ERROR_DEFINITIONS.ALREADY_PROCESSED.message + ALREADY_PROCESSED_CUSTOM_TERMS_SUFFIX,
  );

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling(
    { route: '/api/contracts/[id]/custom-terms', method: 'POST' },
    async (ctx) => {
      const cfg = getServerConfig();
      const supabase = createServerSupabaseClient();

      // 1. Session + ownership
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

      const { data: contract } = await supabase
        .from('contracts')
        .select('id, contract_type, status')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();
      if (!contract) throw appError('NOT_FOUND');

      // 2. Custom terms are a pre-processing-only concept.
      if (contract.status !== 'uploaded' && contract.status !== 'error') throw alreadyProcessed();

      // 3. Schema
      let parsed;
      try {
        parsed = customTermSchema.parse(await request.json());
      } catch {
        throw appError('INVALID_TERM_NAME');
      }
      const names = parsed.term_names.map((n) => n.trim());

      // 4. Case-insensitive dedup against the standard list and existing rows
      const { data: existing } = await supabase
        .from('custom_key_terms')
        .select('id, term_name')
        .eq('contract_id', contract.id);

      const existingLower = new Set((existing ?? []).map((r) => r.term_name.toLowerCase()));
      const incomingLower = new Set<string>();

      for (const name of names) {
        const lower = name.toLowerCase();
        if (isStandardTerm(contract.contract_type as ContractType, name)) {
          throw appErrorWithMessage(
            'DUPLICATE_TERM',
            "That's already one of the standard terms we look for.",
          );
        }
        if (existingLower.has(lower) || incomingLower.has(lower)) throw appError('DUPLICATE_TERM');
        incomingLower.add(lower);
      }

      // 5. Cap — enforced here AND by the DB trigger.
      if ((existing?.length ?? 0) + names.length > cfg.MAX_CUSTOM_TERMS) {
        throw appError('CUSTOM_TERM_LIMIT');
      }

      // 6. Insert
      const { data: inserted, error } = await supabase
        .from('custom_key_terms')
        .insert(
          names.map((term_name) => ({
            contract_id: contract.id,
            user_id: user.id,
            term_name,
            is_manual: true,
          })),
        )
        .select('id, term_name, is_manual');

      if (error) {
        // The trigger is the second, independent enforcement point.
        if (error.message.includes('CUSTOM_TERM_LIMIT')) throw appError('CUSTOM_TERM_LIMIT');
        if (error.code === '23505') throw appError('DUPLICATE_TERM');
        throw appError('INTERNAL');
      }

      return Response.json({ custom_terms: inserted }, { status: 201 });
    },
  );
}
