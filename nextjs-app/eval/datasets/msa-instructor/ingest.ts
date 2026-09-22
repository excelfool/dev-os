import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractPdfText, CorruptPdfError } from '@/lib/pdf/extract-text';
import { loadGoldenSet, type GoldenContract } from '../../lib/golden-set';
import type { LabelledContract } from '../../lib/types';

/**
 * Builds the instructor MSA fixture set (spec 22 §1): for every tab in
 * golden-set.json whose PDF exists at pdfs/<Tab>.pdf, the text is extracted
 * with the app's OWN extract-text path (same [PAGE N] markers the upload route
 * stores), so an eval result is a statement about the production pipeline.
 *
 * Tabs without a PDF, over MAX_PAGES, or unreadable are reported as SKIPPED
 * with the reason — never silently dropped and never counted as PASS.
 */

export interface SkippedTab {
  tab: string;
  reason: string;
}

export interface IngestResult {
  version: string;
  contracts: Array<LabelledContract & { question_by_term: Record<string, string> }>;
  skipped: SkippedTab[];
}

export const PDF_DIR = resolve(process.cwd(), 'eval/datasets/msa-instructor/pdfs');

function maxPages(): number {
  // Read directly so the SKIPPED path works without a full server env.
  const raw = process.env.MAX_PAGES;
  const n = raw ? Number(raw) : 20;
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export async function ingestInstructorSet(): Promise<IngestResult> {
  const golden = loadGoldenSet();
  const contracts: IngestResult['contracts'] = [];
  const skipped: SkippedTab[] = [];
  const limit = maxPages();

  for (const c of golden.contracts) {
    const pdfPath = resolve(PDF_DIR, `${c.contract_id}.pdf`);
    if (!existsSync(pdfPath)) {
      skipped.push({ tab: c.contract_id, reason: `no PDF at pdfs/${c.contract_id}.pdf (download from ${c.pdf_source_url})` });
      continue;
    }
    let extracted;
    try {
      extracted = await extractPdfText(readFileSync(pdfPath));
    } catch (err) {
      skipped.push({
        tab: c.contract_id,
        reason: err instanceof CorruptPdfError ? 'CORRUPT_PDF: extract-text could not read the file' : `extract-text failed: ${String(err)}`,
      });
      continue;
    }
    if (extracted.pageCount > limit) {
      skipped.push({ tab: c.contract_id, reason: `${extracted.pageCount} pages exceeds MAX_PAGES=${limit} (the app rejects it with TOO_MANY_PAGES)` });
      continue;
    }
    if (extracted.wordCount < 100) {
      skipped.push({ tab: c.contract_id, reason: `${extracted.wordCount} words — below the scanned-PDF floor (SCANNED_PDF)` });
      continue;
    }
    contracts.push(toLabelled(c, extracted.text));
  }

  return { version: golden.version, contracts, skipped };
}

function toLabelled(c: GoldenContract, text: string): IngestResult['contracts'][number] {
  return {
    contract_id: c.contract_id,
    contract_type: 'MSA',
    industry: 'saas',
    terms: c.terms.map(({ term_name, expected_value, expected_page }) => ({ term_name, expected_value, expected_page })),
    text,
    question_by_term: Object.fromEntries(c.terms.map((t) => [t.term_name, t.question])),
  };
}

// CLI: `tsx --tsconfig eval/tsconfig.json eval/datasets/msa-instructor/ingest.ts`
if (process.argv[1] && /ingest\.ts$/.test(process.argv[1])) {
  ingestInstructorSet()
    .then((r) => {
      console.log(`instructor set ${r.version}: ${r.contracts.length} ingested, ${r.skipped.length} skipped`);
      for (const c of r.contracts) console.log(`  ${c.contract_id}: ${c.terms.length} terms, ${[...c.text.matchAll(/^\[PAGE \d+\]$/gm)].length} pages`);
      for (const s of r.skipped) console.log(`  SKIPPED ${s.tab}: ${s.reason}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
