'use client';

import { useState } from 'react';
import { KeyTermRow } from './KeyTermRow';
import { termsFor } from '@/lib/ai/term-library';
import type { ContractType, KeyTerm } from '@/types/domain';

/**
 * Terms panel (spec 07 §4). Rows with display_rank ≤ 12 render expanded;
 * the rest collapse under "Show all terms". Collapsed is not hidden — no term
 * is ever withheld from the user.
 */
export function KeyTermsPanel({
  terms,
  contractType,
  userId,
  contractId,
}: {
  terms: KeyTerm[];
  contractType: ContractType;
  userId: string;
  contractId: string;
}) {
  const [showAll, setShowAll] = useState(false);

  const tooltips = new Map(termsFor(contractType).map((t) => [t.term_name, t.tooltip]));
  const primary = terms.filter((t) => t.display_rank <= 12);
  const rest = terms.filter((t) => t.display_rank > 12);

  return (
    <section className="flex flex-col gap-subsection" aria-label="Key terms">
      <h2 className="text-h5 text-grey-900">Key terms ({terms.length})</h2>

      <ul className="flex flex-col">
        {primary.map((term) => (
          <KeyTermRow
            key={term.id}
            term={term}
            tooltip={tooltips.get(term.term_name)}
            userId={userId}
            contractId={contractId}
          />
        ))}

        {showAll &&
          rest.map((term) => (
            <KeyTermRow
              key={term.id}
              term={term}
              tooltip={tooltips.get(term.term_name)}
              userId={userId}
              contractId={contractId}
            />
          ))}
      </ul>

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="self-start text-body text-brand-500 underline"
        >
          {showAll ? 'Show fewer terms' : `Show all terms (${rest.length})`}
        </button>
      )}
    </section>
  );
}
