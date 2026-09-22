import { loadEnv, serviceClient, evalOperatorId, releaseTag } from '../lib/runtime';

loadEnv();

import { runExtractions } from '../lib/extract';
import { ALL_CONTRACTS, PROVENANCE, PROVENANCE_NOTE } from '../lib/dataset';
import { extractionF1, toReportRows } from './extraction-f1';
import type { MatcherVersion } from '../lib/matching';
import { pageAccuracy } from './page-accuracy';
import { termCoverage } from './term-coverage';
import { customTermF1 } from './custom-term-f1';
import { calibration } from './calibration';
import { chatGroundedness, hallucinationRegression, memoryRegression } from './chat-groundedness';
import { latency } from './latency';
import { writeCsv, writeSummary, gate, formatGate } from '../lib/report';

/**
 * Orchestrates the per-release set and writes the report (spec 17 §2).
 *
 *   npm run eval              full run, reusing any cached extractions
 *   npm run eval -- --refresh re-bills the extraction calls
 *   npm run eval -- --offline scores whatever is cached, makes no calls
 *   npm run eval -- --no-chat skips the chat runners
 */
async function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  // v1.1 (spec 22 §1): `--dataset msa-instructor --prompt v1|v2` runs the
  // re-baseline against the instructor golden set and nothing else. It never
  // touches Supabase.
  const flag = (name: string) => {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.split('=')[1];
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (flag('--dataset') === 'msa-instructor') {
    const prompt = flag('--prompt') ?? 'v2';
    if (prompt !== 'v1' && prompt !== 'v2') throw new Error(`--prompt must be v1 or v2, got ${prompt}`);
    const { runRebaseline, explainTerms } = await import('./rebaseline');
    const maxTokensFlag = flag('--max-tokens');
    const explain = flag('--explain');
    if (explain) {
      const terms = explain.split(',').map((t) => t.trim()).filter(Boolean);
      const out = flag('--out') ?? `eval/failures/${new Date().toISOString().slice(0, 10)}-explain.md`;
      process.exitCode = await explainTerms(prompt, { maxTokens: maxTokensFlag ? Number(maxTokensFlag) : undefined }, terms, out);
      return;
    }
    process.exitCode = await runRebaseline(prompt, {
      refresh: args.has('--refresh'),
      maxTokens: maxTokensFlag ? Number(maxTokensFlag) : undefined,
      timeoutMs: Number(flag('--timeout-ms') ?? 120_000),
    });
    return;
  }
  const offline = args.has('--offline');
  const memoryOnly = args.has('--memory-only');
  // The matcher is the instrument. A report says which version scored it, and
  // a re-score writes to its own release so an earlier measurement is never
  // overwritten by a later instrument.
  const matcher: MatcherVersion = [...args].includes('--matcher=v1') ? 'v1' : 'v2';
  const releaseSuffix = [...args].find((a) => a.startsWith('--release-suffix='))?.split('=')[1] ?? '';
  const refresh = args.has('--refresh');
  const skipChat = args.has('--no-chat') || offline;
  // The cache is keyed by the EXTRACTION run, not by the scoring run, so a
  // re-score under a different matcher reuses the same billed calls.
  const cacheRelease = releaseTag();
  const release = cacheRelease + releaseSuffix;

  const supabase = serviceClient();
  const operatorId = offline ? 'offline' : await evalOperatorId(supabase);

  console.log(`\nContractIQ eval · release ${release}`);
  console.log(`  dataset: ${ALL_CONTRACTS.length} contracts, provenance=${PROVENANCE}`);
  console.log(`  matcher: ${matcher}`);
  console.log(`  ${PROVENANCE_NOTE}\n`);

  if (memoryOnly) {
    // Used to demonstrate that this layer catches the conversational-memory
    // regression, by running it against a reverted classifier.
    console.log('conversational memory (only)');
    const only = await memoryRegression({ supabase, operatorId });
    console.log(`\n  memory regression: ${only.failures.length === 0 ? 'PASS' : 'FAIL'} — ${only.turnsRun} turns, ${only.failures.length} failure(s)`);
    for (const failure of only.failures) {
      console.log(`    ✗ ${failure.case}`);
      console.log(`      turn:     ${failure.turn}`);
      console.log(`      expected: ${failure.expected}`);
      console.log(`      got:      ${failure.got}`);
    }
    return;
  }

  console.log('extraction');
  const runs = await runExtractions({ supabase, operatorId, release: cacheRelease, refresh: refresh && !offline, offline });

  const f1 = extractionF1(runs, matcher);
  const pages = pageAccuracy(f1.outcomes);
  const coverage = termCoverage(runs);
  const custom = customTermF1(runs, matcher);
  const calib = calibration(f1.outcomes);

  let chat = null;
  let hallucination = null;
  let memory = null;
  if (!skipChat) {
    console.log('\nchat groundedness');
    chat = await chatGroundedness({ supabase, operatorId });
    console.log('\nhallucination regression');
    hallucination = await hallucinationRegression({ supabase, operatorId });
    console.log('\nconversational memory');
    memory = await memoryRegression({ supabase, operatorId });
  }

  console.log('\nlatency (production tables)');
  const lat = offline
    ? { processingP95Ms: null, processingSamples: 0, chatP95Ms: null, chatSamples: 0 }
    : await latency(supabase);

  // --- gates, spec 18 §4 ---------------------------------------------------
  const gates = [
    gate('F1 — NDA (public launch)', 'f1', f1.nda.f1, 0.88, 'gte'),
    gate('F1 — MSA (public launch)', 'f1', f1.msa.f1, 0.85, 'gte'),
    gate('F1 — overall (beta floor)', 'f1', f1.overall.f1, 0.82, 'gte'),
    gate('Page accuracy', 'accuracy', pages.accuracy, 0.92, 'gte'),
    gate('Standard-term value coverage', 'coverage', coverage.overall.coverage, 0.80, 'gte'),
    gate('Custom-term F1', 'f1', custom.score.f1, 0.80, 'gte'),
    gate('Calibration error', 'error', calib.error, 0.10, 'lte'),
    gate('Chat hallucination rate', 'rate', chat?.rate ?? null, 0.05, 'lte'),
    gate('Latency — processing P95', 'ms', lat.processingP95Ms, 30_000, 'lte'),
    gate('Latency — chat P95', 'ms', lat.chatP95Ms, 15_000, 'lte'),
  ];

  const promptVersion = runs[0]?.promptVersion ?? 'unknown';
  const csvPath = writeCsv(release, [
    ...toReportRows(f1.outcomes, promptVersion),
    ...toReportRows(custom.outcomes, promptVersion),
  ]);

  const summaryPath = writeSummary(release, {
    release,
    prompt_version: promptVersion,
    matcher,
    matcher_note:
      matcher === 'v1'
        ? 'The matcher the first measurement was taken with: exact, substring, duration, date and currency equivalence only.'
        : 'Adds defined-term stripping and content-token subset matching with light stemming. See eval/lib/matching.ts and the by_rule breakdown for how many true positives each rule produced.',
    dataset: {
      provenance: PROVENANCE,
      note: PROVENANCE_NOTE,
      contracts: ALL_CONTRACTS.length,
      nda: ALL_CONTRACTS.filter((c) => c.contract_type === 'NDA').length,
      msa: ALL_CONTRACTS.filter((c) => c.contract_type === 'MSA').length,
    },
    f1: { overall: f1.overall, nda: f1.nda, msa: f1.msa, by_rule: f1.byRule, by_term: f1.byTerm },
    known_label_errors: [
      {
        rows: ['msa-03 · Notice Period', 'msa-04 · Notice Period'],
        scored_as: 'false positive',
        note:
          'Left as labelled on purpose. The UK-style MSAs have no notices clause, so the label says absent, ' +
          'but the model returned the termination notice period, which is defensible. Correcting the label ' +
          'would raise F1 without the model changing, so the label stands and the error is recorded here.',
      },
    ],
    page_accuracy: pages,
    term_coverage: coverage,
    custom_term_f1: custom.score,
    calibration: calib,
    chat_groundedness: chat && { total: chat.total, hallucinated: chat.hallucinated, rate: chat.rate, failures: chat.failures },
    hallucination_regression: hallucination,
    memory_regression: memory,
    latency: lat,
    gates,
    extraction_errors: runs.filter((r) => r.error).map((r) => ({ contract_id: r.contract_id, error: r.error })),
  });

  console.log('\n─── gates (spec 18 §4) ───');
  for (const result of gates) console.log(formatGate(result));

  if (memory) {
    console.log(
      `\n  memory regression: ${memory.failures.length === 0 ? 'PASS' : 'FAIL'} — ${memory.turnsRun} turns, ${memory.failures.length} failure(s)`,
    );
  }
  if (hallucination) {
    console.log(
      `  hallucination regression: ${hallucination.failures.length === 0 ? 'PASS' : 'FAIL'} — ${hallucination.failures.length}/${hallucination.total} answered an absent topic`,
    );
  }

  console.log(`\n  report:  ${csvPath}`);
  console.log(`  summary: ${summaryPath}\n`);

  const failed = gates.filter((g) => g.passed === false);
  if (failed.length > 0) {
    console.log(`  ${failed.length} gate(s) failing: ${failed.map((g) => g.gate).join(', ')}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
