/**
 * The one capability registry (spec 21 §1, PRD v1.1 Appendix A P-1).
 *
 * Static code, not a table: changing a status is a code change plus a deploy,
 * which is what makes it reviewable. Imported by server and client alike, so
 * this file must not import any `server-only` module.
 *
 * Entries are exactly PRD v1.1 Appendix B (2026-09-21) plus
 * `versioning.duplicate_detect` (D46).
 */

export type CapabilityStatus = 'built' | 'stub' | 'planned';

export type CapabilityKey =
  | 'ingest.pdf_text'
  | 'ingest.docx'
  | 'ingest.ocr'
  | 'import.drive'
  | 'import.dropbox'
  | 'import.sharepoint'
  | 'classify.contract_type'
  | 'extract.key_terms'
  | 'extract.summary'
  | 'playbook.manage'
  | 'risk.flag'
  | 'risk.escalate'
  | 'redline.word'
  | 'qa.single_contract'
  | 'qa.cross_contract'
  | 'retrieval.full_context'
  | 'retrieval.query_enhancer'
  | 'retrieval.vector'
  | 'retrieval.graph'
  | 'retrieval.n8n'
  | 'compare.contracts'
  | 'export.csv_pdf'
  | 'reminders.key_dates'
  | 'crm.hubspot'
  | 'crm.salesforce'
  | 'esign.docusign'
  | 'eval.golden_set_instructor'
  | 'eval.hhh_human'
  | 'eval.hhh_judge'
  | 'eval.judge_precision'
  | 'eval.redteam'
  | 'eval.foundry_export'
  | 'observe.guardrail_events'
  | 'observe.alerts'
  | 'rollout.cohorts'
  | 'billing'
  | 'versioning.duplicate_detect'
  | 'pipeline.async';

export interface Capability {
  key: CapabilityKey;
  status: CapabilityStatus;
  /** '—' when built; otherwise the PRD phase label. */
  phase: string;
  owner: 'product' | 'engineering';
  /** PRD v1.1 section / story that defines it. */
  prd_ref: string;
  /** ISO date the entry was added or last changed. */
  since: string;
  /** User-facing name for the /settings table. */
  label: string;
  /** One plain-English sentence for /settings. */
  user_note: string;
}

const SINCE = '2026-09-21';

function entry(
  key: CapabilityKey,
  status: CapabilityStatus,
  phase: string,
  prd_ref: string,
  label: string,
  user_note: string,
  owner: Capability['owner'] = 'product',
): Capability {
  return { key, status, phase, owner, prd_ref, since: SINCE, label, user_note };
}

const ENTRIES: Capability[] = [
  entry('ingest.pdf_text', 'built', '—', '§3 comp 2, FR-03', 'Text-layer PDF upload', 'Upload PDFs up to 10 MB and 20 pages.'),
  entry('ingest.docx', 'stub', 'v1.1', '§1 Why Agentic AI, FR-02', 'Word (.docx) upload', 'Coming in v1.1 — today a .docx is declined with a clear message.'),
  entry('ingest.ocr', 'stub', 'v1.2', '§3 comp 2, Assumption 15', 'Scanned / photographed contracts (OCR)', 'Coming in v1.2 — scanned PDFs are declined today.'),
  entry('import.drive', 'planned', 'v1.1', 'Flow 3 step 1', 'Import from Google Drive', 'Planned for v1.1.'),
  entry('import.dropbox', 'planned', 'v1.1', 'Flow 3 step 1', 'Import from Dropbox', 'Planned for v1.1.'),
  entry('import.sharepoint', 'planned', 'v1.1', 'Flow 3 step 1', 'Import from SharePoint', 'Planned for v1.1.'),
  entry('classify.contract_type', 'built', '—', '§3 comp 3', 'Contract-type check', "Warns when the document doesn't look like the type you chose."),
  entry('extract.key_terms', 'built', '—', '§3 comp 4, §8', 'Key-term extraction (NDA 10 terms, MSA 36 terms)', 'Value, page, confidence, source sentence and reasoning per term.'),
  entry('extract.summary', 'built', '—', 'US-015', 'Plain-language summary', 'A short plain-language summary with page citations, written when a contract is processed.'),
  entry('playbook.manage', 'stub', 'Phase 1', 'US-014', 'Playbooks', 'A default MSA playbook is seeded; editing arrives in Phase 1.'),
  entry('risk.flag', 'stub', 'Phase 1', 'US-013', 'Risk & compliance flags', 'Arrives in Phase 1; the panel shows its status today.'),
  entry('risk.escalate', 'stub', 'Phase 1', '§9 rule 4', 'Hand-off to a human reviewer', 'Arrives in Phase 1.'),
  entry('redline.word', 'planned', 'Phase 2', '§3 roadmap v1.2', 'Redlined Word document', 'Planned.'),
  entry('qa.single_contract', 'built', '—', 'US-007', 'Chat with your contract', 'Grounded answers with page citations.'),
  entry('qa.cross_contract', 'planned', 'Phase 3', '§3 roadmap v2', 'Questions across several contracts', 'Planned.'),
  entry('retrieval.full_context', 'built', '—', '§7', 'Full-document grounding', 'The whole contract is read on every question.'),
  entry('retrieval.query_enhancer', 'planned', 'v0.4', '§7, Flow 4 step 2', 'Question rewriting for better answers', 'First build item.'),
  entry('retrieval.vector', 'stub', 'v2', '§7', 'Vector retrieval for long contracts', 'Reserved for contracts beyond 20 pages.'),
  entry('retrieval.graph', 'planned', 'v2', '§7', 'Knowledge-graph retrieval', 'Planned.'),
  entry('retrieval.n8n', 'stub', '—', '§7', 'External RAG backend (n8n)', 'Available only when an operator configures it.'),
  entry('compare.contracts', 'stub', 'v1.2', '§3 roadmap v1.2', 'Compare two contracts', 'Coming in v1.2.'),
  entry('export.csv_pdf', 'built', 'v1.1', 'US-011', 'Export to CSV / PDF', 'Available on Free Trial, Growth and Pro.'),
  entry('reminders.key_dates', 'stub', 'v1.1', 'US-017', 'Renewal and expiry reminders', 'Key dates are recorded today; email reminders arrive in v1.1.'),
  entry('crm.hubspot', 'stub', 'Phase 1', 'US-016', 'Push key terms to HubSpot', 'Arrives in Phase 1.'),
  entry('crm.salesforce', 'stub', 'Phase 1', 'US-016', 'Push key terms to Salesforce', 'Arrives after HubSpot.'),
  entry('esign.docusign', 'stub', 'GA', '§3 roadmap v1.2', 'DocuSign hand-off', 'Planned for general availability.'),
  entry('eval.golden_set_instructor', 'planned', '—', '§10 dataset 1', 'Instructor golden set', 'Internal evaluation dataset.', 'engineering'),
  entry('eval.hhh_human', 'planned', '—', '§10 HHH', 'Expert review mode', 'Internal quality scoring.', 'engineering'),
  entry('eval.hhh_judge', 'stub', 'after 50 human rows', '§10 judge', 'LLM-as-judge scoring', 'Internal quality scoring.', 'engineering'),
  entry('eval.judge_precision', 'stub', 'after 50 human rows', '§10 judge', 'Judge precision / recall gate', 'Internal quality scoring.', 'engineering'),
  entry('eval.redteam', 'planned', '—', '§9 red teaming', 'Red-team attack suite', 'Internal safety testing.', 'engineering'),
  entry('eval.foundry_export', 'planned', '—', '§10 exports', 'Foundry JSONL export', 'Internal evaluation export.', 'engineering'),
  entry('observe.guardrail_events', 'stub', 'v1.0', '§11 Observability', 'Guardrail event log', 'Internal observability.', 'engineering'),
  entry('observe.alerts', 'stub', 'v1.0', '§11 Observability', 'Alert rules', 'Internal observability.', 'engineering'),
  entry('rollout.cohorts', 'stub', 'v1.0', '§5 sampling', 'Rollout cohorts', 'Internal launch sizing.', 'engineering'),
  entry('billing', 'planned', 'GA', '§12, A-06', 'Self-service billing', 'Plan changes are handled by our team today.'),
  // D46 — content-hash duplicate detection on upload.
  entry('versioning.duplicate_detect', 'built', 'v1.1', 'D46', 'Duplicate upload detection', 'Tells you when you upload a file you have already analysed.'),
  // D49 a (Stage 5b): POST /process hands the run to the Netlify background
  // function when PROCESS_JOB_SECRET is set, so extraction is no longer bound
  // by the 24 s request deadline.
  entry('pipeline.async', 'built', '—', '§5', 'Background processing for long contracts', 'Long contracts are processed in the background; the results page updates when they finish.', 'engineering'),
];

export const CAPABILITIES: Readonly<Record<CapabilityKey, Capability>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((c) => [c.key, c])) as Record<CapabilityKey, Capability>,
);

/** Every entry, sorted by key — the shape `GET /api/capabilities` returns. */
export function listCapabilities(): Capability[] {
  return [...ENTRIES].sort((a, b) => a.key.localeCompare(b.key));
}

export function getCapability(key: CapabilityKey): Capability {
  const c = CAPABILITIES[key];
  if (!c) throw new Error(`Unknown capability key: ${key}`);
  return c;
}

export function isBuilt(key: CapabilityKey): boolean {
  return getCapability(key).status === 'built';
}

/** Alias required by the Stage 3 task wording; identical to `isBuilt`. */
export function isEnabled(key: CapabilityKey): boolean {
  return isBuilt(key);
}

/**
 * PRD §11 Accountability limitations copy, assembled from the registry so it
 * cannot drift from it (spec 21 §3).
 */
export function limitationsCopy(): string {
  const parts: string[] = [
    'ContractIQ extracts standard NDA and MSA terms from English-language, text-layer PDFs. It does not provide legal advice',
  ];
  const ocr = !isBuilt('ingest.ocr');
  const docx = !isBuilt('ingest.docx');
  if (ocr && docx) parts.push('does not yet handle scanned PDFs or DOCX');
  else if (ocr) parts.push('does not yet handle scanned PDFs');
  else if (docx) parts.push('does not yet handle DOCX');
  parts.push('does not support non-English contracts');
  if (!isBuilt('risk.flag')) parts.push('does not yet flag risks');
  parts.push('and may miss highly unusual or bespoke clauses.');
  return parts.join(', ');
}
