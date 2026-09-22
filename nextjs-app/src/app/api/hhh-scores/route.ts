import { createServerSupabaseClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { APPLICABLE_CODES, columnFor, type HhhSubjectType } from '@/lib/eval/hhh-codes';
import {
  hhhScoreSchema,
  inapplicableCodes,
  subjectIdError,
  type HhhScoreInput,
} from '@/lib/validation/hhh-score.schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What the reviewer gets back: the verdicts the trigger computed. */
const VERDICT_COLUMNS = 'id, helpful_verdict, honest_verdict, harmless_verdict';

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * PUT /api/hhh-scores (route 32, spec 22 §4).
 *
 * Review mode saves one reviewer's answers for one subject — a key term, the
 * summary, or an assistant chat answer. Idempotent per (subject, reviewer):
 * saving again replaces that reviewer's answers rather than adding a row.
 *
 * **The verdict columns are never sent.** `compute_hhh_verdicts()` runs BEFORE
 * INSERT OR UPDATE and derives them from the polarity table; a client that
 * sent them would be asserting a pillar outcome it did not compute, and the
 * trigger would overwrite it anyway. They are read back and returned.
 */
export async function PUT(request: Request) {
  return withErrorHandling({ route: '/api/hhh-scores', method: 'PUT' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw appError('INVALID_HHH_ANSWERS');
    }

    const parsed = hhhScoreSchema.safeParse(raw);
    if (!parsed.success) throw appError('INVALID_HHH_ANSWERS');
    const input: HhhScoreInput = parsed.data;

    // Exactly one subject id, per `hhh_scores_subject_check`.
    if (subjectIdError(input) !== null) throw appError('INVALID_HHH_ANSWERS');
    const subjectType = input.subject_type as HhhSubjectType;

    // A code this subject is never asked would land in a column the judge
    // leaves NULL for it, quietly skewing that pillar's rate.
    if (inapplicableCodes(subjectType, input.answers).length > 0) throw appError('INVALID_HHH_ANSWERS');

    // Ownership is re-verified here, not inferred from the body: RLS would
    // refuse the write anyway, but a 404 is the honest answer and it keeps
    // another user's ids indistinguishable from missing ones.
    const { data: contract } = await supabase
      .from('contracts')
      .select('id, prompt_version, term_library_version')
      .eq('id', input.contract_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!contract) throw appError('NOT_FOUND');

    if (input.term_id) {
      const { data: term } = await supabase
        .from('key_terms')
        .select('id')
        .eq('id', input.term_id)
        .eq('contract_id', input.contract_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!term) throw appError('NOT_FOUND');
    }

    if (input.message_id) {
      // 5d-3a: scoped to the contract in the body, not just to the user. An
      // owner with two contracts could otherwise file an answer against the
      // wrong one, and the score would count towards a contract the answer
      // was never about. `chat_sessions` is the only link between the two.
      const { data: message } = await supabase
        .from('chat_messages')
        .select('id, chat_sessions!inner(contract_id)')
        .eq('id', input.message_id)
        .eq('user_id', user.id)
        .eq('chat_sessions.contract_id', input.contract_id)
        .maybeSingle();
      if (!message) throw appError('NOT_FOUND');
    }

    // Every applicable code is written, so clearing an answer back to Skip
    // clears the stored column instead of leaving the previous value behind.
    const answerColumns: Record<string, boolean | null> = {};
    for (const code of APPLICABLE_CODES[subjectType]) {
      const column = columnFor(code);
      if (!column) continue;
      answerColumns[column] = input.answers[code] ?? null;
    }

    const notes = input.notes ?? null;

    /**
     * L13 (5d-3a): the reviewer's own human rows, counted after the write.
     *
     * The Review footer used to show a number nothing ever set, so it read 0
     * however many rows existed. Returning it with every save means the count
     * is right from the first one, without a second round trip. RLS already
     * limits this to rows the caller may read; the filters state the same
     * thing explicitly so the number matches what the footer claims it is.
     */
    const countHumanRows = async (): Promise<number> => {
      const { count } = await supabase
        .from('hhh_scores')
        .select('id', { count: 'exact', head: true })
        .eq('evaluator', 'human')
        .eq('created_by', user.id);
      return count ?? 0;
    };

    /** Updates this reviewer's existing row; the trigger recomputes verdicts. */
    const updateRow = async (id: string) => {
      const { data, error } = await supabase
        .from('hhh_scores')
        .update({ ...answerColumns, notes })
        .eq('id', id)
        .eq('created_by', user.id)
        .select(VERDICT_COLUMNS)
        .maybeSingle();
      if (error || !data) throw appError('INTERNAL');
      return data;
    };

    // The uniqueness is a PARTIAL index (`WHERE evaluator='human'`), which
    // PostgREST cannot name in `on_conflict`, so the upsert is done by hand:
    // find this reviewer's row for this subject, update it, else insert.
    // Built fresh each call — a PostgREST builder is single-use.
    const findExisting = async () => {
      let query = supabase
        .from('hhh_scores')
        .select('id')
        .eq('contract_id', input.contract_id)
        .eq('subject_type', input.subject_type)
        .eq('evaluator', 'human')
        .eq('created_by', user.id);
      if (input.term_id) query = query.eq('term_id', input.term_id);
      if (input.message_id) query = query.eq('message_id', input.message_id);
      const { data } = await query.maybeSingle();
      return (data?.id as string | undefined) ?? null;
    };

    const existingId = await findExisting();
    if (existingId) {
      const updated = await updateRow(existingId);
      return Response.json({ ...updated, human_row_count: await countHumanRows() });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('hhh_scores')
      .insert({
        user_id: user.id,
        contract_id: input.contract_id,
        subject_type: input.subject_type,
        ...(input.term_id ? { term_id: input.term_id } : {}),
        ...(input.message_id ? { message_id: input.message_id } : {}),
        evaluator: 'human',
        scorer_role: 'owner',
        created_by: user.id,
        prompt_version: (contract.prompt_version as string | null) ?? 'v1.0',
        term_library_version: (contract.term_library_version as string | null) ?? null,
        ...answerColumns,
        notes,
      })
      .select(VERDICT_COLUMNS)
      .maybeSingle();

    if (insertError) {
      // A concurrent save won the race — two tabs, or a debounce that fired
      // twice. The row that exists is this reviewer's, so update it.
      if (insertError.code !== UNIQUE_VIOLATION) throw appError('INTERNAL');
      const racedId = await findExisting();
      if (!racedId) throw appError('INTERNAL');
      const updated = await updateRow(racedId);
      return Response.json({ ...updated, human_row_count: await countHumanRows() });
    }
    if (!inserted) throw appError('INTERNAL');

    return Response.json({ ...inserted, human_row_count: await countHumanRows() });
  });
}
