import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * First-party product analytics (spec 01 §5). The event vocabulary is closed —
 * spec 14 §3 is its single source, and a new value must be added there first.
 */
export type ActivityEventType =
  | 'session_start'
  | 'auth_complete'
  | 'upload_start'
  | 'upload_complete'
  | 'process_started'
  | 'results_viewed'
  | 'term_edited'
  | 'chat_message_sent'
  | 'review_completed'
  | 'export_generated'
  | 'pdf_render_failed'
  | 'onboarding_tip_dismissed';

/** Keys that could carry contract or chat content. Rejected outright. */
const FORBIDDEN_KEYS = new Set(['content', 'text', 'value', 'source_sentence']);
const MAX_METADATA_STRING = 200;

export class MetadataGuardError extends Error {}

/**
 * Metadata must never contain contract text, term values or chat content
 * (spec 01 §5). Enforced at runtime, not by convention.
 */
export function assertSafeMetadata(metadata: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new MetadataGuardError(`activity_events metadata may not contain the key "${key}"`);
    }
    if (typeof value === 'string' && value.length > MAX_METADATA_STRING) {
      throw new MetadataGuardError(
        `activity_events metadata value for "${key}" exceeds ${MAX_METADATA_STRING} characters`,
      );
    }
  }
}

export interface ActivityEventInput {
  userId: string;
  contractId?: string | null;
  eventType: ActivityEventType;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export async function recordEvent(
  supabase: SupabaseClient,
  input: ActivityEventInput,
): Promise<void> {
  if (input.metadata) assertSafeMetadata(input.metadata);

  const { error } = await supabase.from('activity_events').insert({
    user_id: input.userId,
    contract_id: input.contractId ?? null,
    event_type: input.eventType,
    duration_ms: input.durationMs ?? null,
    metadata: input.metadata ?? null,
  });

  if (error) console.error(JSON.stringify({ telemetry: 'activity_events', error: error.message }));
}
