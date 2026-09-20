# Eval suite (spec 17)

```bash
npm run eval                      # full run; reuses cached extractions
npm run eval -- --refresh         # re-bills the extraction calls
npm run eval -- --no-chat         # extraction metrics only
npm run eval -- --memory-only     # the conversational-memory regression alone
npm run eval:offline              # scores the cache, makes no calls at all
```

Output: `eval/reports/<release>.csv` (the PRD's columns plus `Prompt_Version`)
and `<release>.summary.json` (aggregates, per-term breakdown, calibration
buckets, gate verdicts).

## What runs against the live model

Everything except `--offline`. The runners import the **shipped** services —
`buildExtractionSystemPrompt`, `callLlm`, `parseJsonResponse`,
`processExtraction`, `classifyQuery`, `assembleChatMessages`,
`validateCitations` — so a result is a statement about the production pipeline
and not about a copy of it (spec 17 §2).

Extraction results are cached per release under `eval/reports/.cache/`, so the
five runners that derive from extraction share one set of billed calls. Spend is
tagged in `openai_calls` against a dedicated `eval.operator@contractiq.local`
user so it can be excluded from the production cost rollup (spec 17 §7).

## The matcher is versioned, and so are the reports

F1 depends on a value-matching function as much as on the model. That function
is versioned so a score can never be silently re-based.

| Report | Matcher | NDA F1 | MSA F1 | Calibration error |
|---|---|---|---|---|
| `2026-09-20` | v1 | 75.9% | 66.7% | 21.8% |
| `2026-09-20-matcher-v2` | v2 | 98.1% | 95.2% | 2.9% |

**Both are the same model output.** The extraction cache is keyed by the
extraction run, not the scoring run, so the v2 report re-scores the identical
billed calls. The difference between those rows is entirely the instrument.

`2026-09-20` is kept exactly as written and is the only measurement nobody
tuned toward. It has no `matcher` field because it predates versioning; that
absence means v1 and is left rather than backfilled, because editing a
preserved measurement is the thing the versioning exists to prevent.

### What v2 accepts that v1 did not

- **`defined-terms`** — parenthetical defined terms and quoted labels are
  stripped before comparison, so `Ashgrove Therapeutics Limited ("the
  Disclosing Party") and Northwind Diagnostics plc` matches a label carrying
  the bare party names.
- **`token-subset`** — if every content word of one side appears in the other,
  the two state the same fact at different lengths. Stopwords are dropped and a
  small stemmer folds `indemnifies`/`indemnify`, `infringement`/`infringe`,
  `claims`/`claim`.

### What v2 still rejects

- **A different fact.** `the State of Delaware` vs `the State of New York`.
- **Differing numbers, always.** A token containing a digit is compared
  literally — never stemmed, never prefix-matched — so `$2,000,000` can never
  satisfy `$5,000,000`, and `two (2) years` never satisfies `three (3) years`.
- **A partial answer that drops facts the label carries.** `by email to the
  addresses set out in the Statement of Work, with confirmation of receipt` vs
  `Written notice delivered by email with confirmation of receipt` — neither
  side contains the other, so it stays a miss.

Each of these is a test in `tests/unit/eval-deterministic.test.ts`.

### Telling a loosened matcher from a better model

Every true positive records the rule that produced it, in the CSV `Notes`
column (`tp:exact`, `tp:token-subset`, …) and aggregated in the summary's
`f1.by_rule`. For the v2 re-score:

```
substring       52   55.9%
token-subset    18   19.4%   <- the loosest rule
exact           15   16.1%
defined-terms    6    6.5%
duration         2    2.2%
```

So roughly a quarter of the v2 true positives come from the two rules v2 added.
A reader who distrusts `token-subset` can subtract it and see what is left.

## Deterministic tests

`tests/unit/eval-deterministic.test.ts` covers the arithmetic and the prompt
assembly with no model call, so it gates every PR (spec 17 §6). The live
runners stay on the release cadence.

## Read the provenance before quoting a number

`eval/datasets/README.md`. The corpus is synthetic.
