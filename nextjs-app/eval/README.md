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

## Deterministic tests

`tests/unit/eval-deterministic.test.ts` covers the arithmetic and the prompt
assembly with no model call, so it gates every PR (spec 17 §6). The live
runners stay on the release cadence.

## Read the provenance before quoting a number

`eval/datasets/README.md`. The corpus is synthetic.
