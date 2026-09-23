'use client';

import { Capability } from '@/components/layout/Capability';

/** Spec 20 §4.2, verbatim. */
export const ESCALATE_STUB_NOTE = 'A human reviewer hand-off arrives in Phase 1.';

/**
 * `EscalateOffer` (spec 20 §4.2): shown under the last assistant bubble once
 * the unresolved-turn counter reaches 3 (§5.1). The offer is a UI affordance,
 * never model text, so the assistant never promises an action it cannot take.
 *
 * `risk.escalate` is a stub: a muted, informational note and no button. The
 * built form — "Ask a human reviewer" → note dialog → POST /escalate — lands
 * with the capability; until then nothing here is interactive.
 */
export function EscalateOffer() {
  return (
    <Capability
      capability="risk.escalate"
      fallback={
        <p role="note" aria-label="Human reviewer" className="text-caption text-grey-400">
          {ESCALATE_STUB_NOTE}
        </p>
      }
    >
      {null}
    </Capability>
  );
}
