'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Info, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfoTooltip } from '@/components/ui/tooltip';
import { ProcessingSteps, type ProcessingStage } from './ProcessingSteps';
import { publicConfig } from '@/lib/utils/config';
import type { StandardTerm } from '@/lib/ai/term-library';
import type { ContractType } from '@/types/domain';

export interface ExistingCustomTerm {
  id: string;
  term_name: string;
}

export function PrepareView({
  contractId,
  contractType,
  standardTerms,
  initialCustomTerms,
  standardTermNames,
  storageAvailable,
  startProcessing,
}: {
  contractId: string;
  contractType: ContractType;
  standardTerms: StandardTerm[];
  initialCustomTerms: ExistingCustomTerm[];
  standardTermNames: string[];
  storageAvailable: boolean;
  startProcessing: boolean;
}) {
  const router = useRouter();
  const [customTerms, setCustomTerms] = useState(initialCustomTerms);
  const [draft, setDraft] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [termError, setTermError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(startProcessing);
  const [stage, setStage] = useState<ProcessingStage>('analysing');
  const [failure, setFailure] = useState<string | null>(null);
  const [showAllTerms, setShowAllTerms] = useState(false);
  const expandedTerms = standardTerms.filter((t) => t.display_rank <= 12);
  const collapsedTerms = standardTerms.filter((t) => t.display_rank > 12);

  const atLimit = customTerms.length >= publicConfig.maxCustomTerms;

  async function addTerm() {
    const name = draft.trim();
    setTermError(null);

    if (name.length < 3 || name.length > 60) {
      setTermError('Custom term names must be 3–60 characters.');
      return;
    }
    if (standardTermNames.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTermError("That's already one of the standard terms we look for.");
      return;
    }
    if (customTerms.some((t) => t.term_name.toLowerCase() === name.toLowerCase())) {
      setTermError("You've already added that term.");
      return;
    }

    // Optimistic, reconciled against the server response.
    const optimistic = { id: `optimistic-${Date.now()}`, term_name: name };
    setCustomTerms((prev) => [...prev, optimistic]);
    setDraft('');
    setIsAdding(false);

    try {
      const res = await fetch(`/api/contracts/${contractId}/custom-terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term_names: [name] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Could not add that term.');

      setCustomTerms((prev) =>
        prev.map((t) => (t.id === optimistic.id ? body.custom_terms[0] : t)),
      );
    } catch (err) {
      setCustomTerms((prev) => prev.filter((t) => t.id !== optimistic.id));
      setTermError(err instanceof Error ? err.message : 'Could not add that term.');
    }
  }

  async function removeTerm(term: ExistingCustomTerm) {
    const previous = customTerms;
    setCustomTerms((prev) => prev.filter((t) => t.id !== term.id));

    const res = await fetch(`/api/contracts/${contractId}/custom-terms/${term.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setCustomTerms(previous);
      setTermError('Could not remove that term.');
    }
  }

  async function process() {
    setIsProcessing(true);
    setFailure(null);
    setStage('analysing');

    try {
      const res = await fetch(`/api/contracts/${contractId}/process`, { method: 'POST' });
      const body = await res.json();

      if (!res.ok) {
        setFailure(body.error?.message ?? 'Something went wrong on our side. Please try again.');
        return;
      }

      setStage('compiling');
      router.push(`/contracts/${contractId}`);
    } catch {
      setFailure("We couldn't reach the AI service. Try again in a few minutes.");
    }
  }

  if (isProcessing) {
    return (
      <ProcessingSteps
        stage={stage}
        failedAt={failure ? stage : null}
        errorMessage={failure}
        onRetry={() => void process()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-component">
      {!storageAvailable && (
        <p role="status" className="rounded-card bg-warning-50 p-4 text-caption text-warning-900">
          The PDF preview isn&apos;t available for this contract — we&apos;ll show the contract text
          instead.
        </p>
      )}

      <section className="flex flex-col gap-subsection">
        <h2 className="text-h5 text-grey-900">
          ContractIQ will look for these {standardTerms.length} terms in your {contractType}.
        </h2>

        <ul className="flex flex-col divide-y divide-grey-50">
          {[...expandedTerms, ...(showAllTerms ? collapsedTerms : [])].map((term) => (
            <li key={term.term_name} className="flex flex-col gap-0.5 py-3">
              <span className="flex items-center gap-2">
                <span className="text-body text-grey-900">{term.term_name}</span>
                <InfoTooltip label={term.tooltip}>
                  <Info aria-hidden="true" className="h-4 w-4" />
                </InfoTooltip>
              </span>
              <span className="text-caption text-grey-400">
                We&apos;ll ask: <em>{term.question}</em>
              </span>
            </li>
          ))}

          {customTerms.map((term) => (
            <li key={term.id} className="flex items-center justify-between gap-2 py-3">
              <span className="flex items-center gap-2">
                <span className="text-body text-grey-900">{term.term_name}</span>
                <Badge tone="brand">Custom</Badge>
              </span>
              <button
                type="button"
                onClick={() => void removeTerm(term)}
                aria-label={`Remove ${term.term_name}`}
                className="rounded-btn p-1 text-grey-300 hover:text-danger-700"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        {collapsedTerms.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAllTerms((v) => !v)}
            aria-expanded={showAllTerms}
            className="self-start text-body text-brand-500 underline"
          >
            {showAllTerms ? 'Show fewer terms' : `Show all ${standardTerms.length} terms`}
          </button>
        )}
      </section>

      <section className="flex flex-col gap-2">
        {isAdding ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="custom-term" className="text-body text-grey-900">
              Add a key term
            </label>
            <div className="flex gap-2">
              <Input
                id="custom-term"
                value={draft}
                autoFocus
                placeholder="e.g. Non-compete radius"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addTerm();
                  }
                  if (e.key === 'Escape') {
                    setIsAdding(false);
                    setDraft('');
                    setTermError(null);
                  }
                }}
                aria-invalid={Boolean(termError)}
              />
              <Button onClick={() => void addTerm()}>Add</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setIsAdding(true)} disabled={atLimit}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add Key Term
          </Button>
        )}

        {atLimit && (
          <p className="text-caption text-grey-400">5 custom terms is the limit for now.</p>
        )}
        {termError && (
          <p role="alert" className="text-caption text-danger-700">
            {termError}
          </p>
        )}
      </section>

      <Button size="lg" onClick={() => void process()} className="self-start">
        Process Contract
      </Button>
    </div>
  );
}
