import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  getCapability,
  isBuilt,
  isEnabled,
  limitationsCopy,
  listCapabilities,
} from '@/lib/capabilities';
import { notImplemented } from '@/lib/errors/app-error';

/** Spec 21 §9 — the registry is exactly PRD v1.1 Appendix B plus D46. */

// PRD v1.1 Appendix B, in order. `import.*` and `crm.*` are one row each in
// the PRD but separate keys in the registry (spec 21 §1.2).
const APPENDIX_B: Array<[string, 'built' | 'stub' | 'planned']> = [
  ['ingest.pdf_text', 'built'],
  ['ingest.docx', 'stub'],
  ['ingest.ocr', 'stub'],
  ['import.drive', 'planned'],
  ['import.dropbox', 'planned'],
  ['import.sharepoint', 'planned'],
  ['classify.contract_type', 'built'],
  ['extract.key_terms', 'built'],
  ['extract.summary', 'planned'],
  ['playbook.manage', 'stub'],
  ['risk.flag', 'stub'],
  ['risk.escalate', 'stub'],
  ['redline.word', 'planned'],
  ['qa.single_contract', 'built'],
  ['qa.cross_contract', 'planned'],
  ['retrieval.full_context', 'built'],
  ['retrieval.query_enhancer', 'planned'],
  ['retrieval.vector', 'stub'],
  ['retrieval.graph', 'planned'],
  ['retrieval.n8n', 'stub'],
  ['compare.contracts', 'stub'],
  ['export.csv_pdf', 'built'],
  ['reminders.key_dates', 'stub'],
  ['crm.hubspot', 'stub'],
  ['crm.salesforce', 'stub'],
  ['esign.docusign', 'stub'],
  ['eval.golden_set_instructor', 'planned'],
  ['eval.hhh_human', 'planned'],
  ['eval.hhh_judge', 'stub'],
  ['eval.judge_precision', 'stub'],
  ['eval.redteam', 'planned'],
  ['eval.foundry_export', 'planned'],
  ['observe.guardrail_events', 'stub'],
  ['observe.alerts', 'stub'],
  ['rollout.cohorts', 'stub'],
  ['billing', 'planned'],
];

describe('capability registry', () => {
  it('has every Appendix B key with the PRD status, plus versioning.duplicate_detect', () => {
    for (const [key, status] of APPENDIX_B) {
      expect(CAPABILITIES[key as keyof typeof CAPABILITIES]?.status, key).toBe(status);
    }
    expect(CAPABILITIES['versioning.duplicate_detect'].status).toBe('built');
    expect(Object.keys(CAPABILITIES)).toHaveLength(APPENDIX_B.length + 1);
  });

  it('every entry has a valid status, a non-empty phase, prd_ref, label, note and ISO since', () => {
    for (const c of Object.values(CAPABILITIES)) {
      expect(['built', 'stub', 'planned']).toContain(c.status);
      expect(c.phase.length).toBeGreaterThan(0);
      expect(c.prd_ref.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.user_note.length).toBeGreaterThan(0);
      expect(c.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['product', 'engineering']).toContain(c.owner);
    }
  });

  it('prints the total and the first three entries sorted by key', () => {
    const list = listCapabilities();
    const first = list.slice(0, 3).map((c) => `${c.key} (${c.status}, ${c.phase})`);
    // Printed so the run log carries the registry shape (Stage 3 report).
    console.log(`registry keys: ${list.length}; first three: ${first.join(' | ')}`);
    expect(list.length).toBe(37);
    expect(list.map((c) => c.key)).toEqual([...list.map((c) => c.key)].sort());
  });

  it('getCapability / isBuilt / isEnabled agree', () => {
    expect(getCapability('ingest.pdf_text').label).toBe('Text-layer PDF upload');
    expect(isBuilt('ingest.pdf_text')).toBe(true);
    expect(isEnabled('ingest.docx')).toBe(false);
    expect(isEnabled('versioning.duplicate_detect')).toBe(true);
  });

  it('notImplemented() builds a 501 carrying the key, and throws for a built key', () => {
    const err = notImplemented('crm.hubspot');
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.httpStatus).toBe(501);
    expect(err.userMessage).toBe('Push key terms to HubSpot arrives in Phase 1.');
    expect(err.details).toMatchObject({ capability: 'crm.hubspot', phase: 'Phase 1' });
    expect(() => notImplemented('ingest.pdf_text')).toThrow(/built capability/);
  });

  it('the 501 envelope copies capability and phase', async () => {
    const body = await notImplemented('retrieval.n8n').toResponse().json();
    expect(body.error).toMatchObject({
      code: 'NOT_IMPLEMENTED',
      capability: 'retrieval.n8n',
      phase: '—',
      retryable: false,
    });
    expect(body.error.message).toBe('External RAG backend (n8n) arrives in a later release.');
  });

  it('the limitations copy is assembled from the registry', () => {
    expect(limitationsCopy()).toBe(
      'ContractIQ extracts standard NDA and MSA terms from English-language, text-layer PDFs. It does not provide legal advice, does not yet handle scanned PDFs or DOCX, does not support non-English contracts, does not yet flag risks, and may miss highly unusual or bespoke clauses.',
    );
  });
});
