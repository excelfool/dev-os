import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import {
  KEY_TERM_FIELD_ERROR_CODE,
  keyTermUpdateSchema,
  type KeyTermUpdateInput,
} from '@/lib/validation/key-term.schema';
import { KEY_DATE_SOURCE_TERMS, deriveKeyDatesBounded } from '@/lib/services/reminder-service';
import type { ContractType } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The §D response shape, in the order the spec lists it. */
const RESPONSE_COLUMNS =
  'id, value, page_number, reasoning, is_edited, page_edited, reasoning_edited, original_ai_value, original_ai_page, original_ai_reasoning, edited_at';

/**
 * Validates the body and maps a failure to that FIELD's code (spec 07 v1.1
 * §D). A body with no editable field at all is `VALIDATION`, not a field
 * error: nothing was wrong with what the user typed, there was nothing to save.
 */
function parseBody(raw: unknown): KeyTermUpdateInput {
  const parsed = keyTermUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const code = typeof field === 'string' ? KEY_TERM_FIELD_ERROR_CODE[field as never] : undefined;
    throw appError(code ?? 'VALIDATION');
  }
  if (Object.keys(parsed.data).length === 0) throw appError('VALIDATION');
  return parsed.data;
}

/**
 * PATCH /api/key-terms/{id} (spec 07 v1.1 §D, spec 12 route 9).
 *
 * Accepts any non-empty subset of `{ value, page_number, reasoning }` and sets
 * the edited-flag for each field present, plus `edited_at` always.
 *
 * `original_ai_value`, `original_ai_page` and `original_ai_reasoning` are NEVER
 * modified — they were captured at insert and are what make the correction-rate
 * metric and the accuracy audit trail meaningful. Nothing in the database
 * enforces that (there is no trigger on `key_terms`), so this handler being the
 * only writer is the guarantee, and a unit test asserts the update payload
 * carries no `original_ai_*` key.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withErrorHandling({ route: '/api/key-terms/[id]', method: 'PATCH' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw appError('VALIDATION');
    }
    const patch = parseBody(body);

    // Load the term first: the page ceiling is the contract's, so the row has
    // to be resolved before `page_number` can be judged, and a term the user
    // does not own must 404 before any validation detail leaks.
    const { data: term } = await supabase
      .from('key_terms')
      .select('id, term_name, contract_id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle();
    // Another user's term id is indistinguishable from a missing one.
    if (!term) throw appError('NOT_FOUND', { noun: 'key term' });

    const { data: contract } = await supabase
      .from('contracts')
      .select('page_count, contract_type')
      .eq('id', term.contract_id)
      .single();

    if (patch.page_number !== undefined) {
      const pageCount = Number(contract?.page_count ?? 0);
      if (patch.page_number > pageCount) throw appError('INVALID_PAGE', { page_count: pageCount });
    }

    const update: Record<string, unknown> = { edited_at: new Date().toISOString() };
    if (patch.value !== undefined) {
      update.value = patch.value;
      update.is_edited = true;
    }
    if (patch.page_number !== undefined) {
      update.page_number = patch.page_number;
      update.page_edited = true;
    }
    if (patch.reasoning !== undefined) {
      update.reasoning = patch.reasoning;
      update.reasoning_edited = true;
    }

    const { data: updated, error } = await supabase
      .from('key_terms')
      .update(update)
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select(RESPONSE_COLUMNS)
      .maybeSingle();

    if (error) throw appError('INTERNAL');
    if (!updated) throw appError('NOT_FOUND', { noun: 'key term' });

    // Spec 21 §7.2: editing a reminder-source term's VALUE re-derives its key
    // date. A page or reasoning edit changes no date, so it does not.
    if (patch.value !== undefined) {
      const type = (contract?.contract_type ?? 'NDA') as ContractType;
      if (KEY_DATE_SOURCE_TERMS[type].includes(term.term_name as string)) {
        await deriveKeyDatesBounded(supabase, term.contract_id as string, user.id, type);
      }
    }

    return Response.json(updated);
  });
}
