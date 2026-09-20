# Eval datasets — provenance

**Nothing here is SME-annotated and nothing here is CUAD.** Spec 17 §1 calls for
30 SME-annotated NDAs, 20 MSAs, a CUAD subset, 50 expert-labelled chat Q&A pairs
and a 50-contract rendering corpus. None of that exists yet.

What does exist is a **synthetic corpus authored alongside the harness**:

| Set | Built | Spec 17 §1 asks for |
|---|---|---|
| `nda-corpus.ts` | 6 NDAs, 3 drafting styles | 30, SME-annotated |
| `msa-corpus.ts` | 4 MSAs, 2 drafting styles | 20, SME-annotated |
| `custom-terms.ts` | 10 custom terms across 10 contracts | 10 terms × 15 contracts |
| `chat-qa.ts` | 30 Q&A pairs | 50, expert-labelled |
| `chat-memory.ts` | 5 multi-turn cases | not in the spec — see below |
| `hallucination.ts` | 12 absent-topic probes | contracts paired with absent topics |
| `cuad-subset/` | **absent** | sampled CUAD |
| `render-corpus/` | **absent** | 50 real-world PDFs (spec 18) |

Ground truth is correct **by construction**: the prose was written around the
values, so the labels cannot disagree with the documents. What that buys is a
working harness and a real regression signal. What it does not buy is an
accuracy figure that means anything about real contracts — the drafting is ours,
so the model is being read prose written by the same process that wrote the
answers. **These figures are not the launch-gate evidence spec 18 §4 calls for**,
and the provenance is recorded in every summary as `synthetic` so a report can
never be mistaken for one.

A-15 requires the reduced confidence to be recorded when no SME annotation is
available. This file and the `provenance` field are that record.

## Why `chat-memory.ts` exists

It is not in spec 17. It is here because of a specific escape: the four-turn
memory test failed live in a browser on both of its classification turns while
every unit test for the four query classes was green. Those tests called
`classifyQuery` directly and never reached the prompt the model is actually
sent, so they could not see it.

Each case is a **sequence**, and the assertion is on the **answer**, not only on
the class — because one of the two bugs classified correctly and still returned
the refusal. Run `npm run eval -- --memory-only` to exercise it alone.
