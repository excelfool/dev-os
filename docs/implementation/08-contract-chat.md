# 08 — Contract Chat (Grounded Q&A)

**Requirements:** US-007, US-012, FR-08, FR-09; PRD §4 Flow 4, §7 grounding, §8 prompt strategy, §9 chat guardrails, Assumptions 11 and 14; engineering-doc §4.4, §8.3, §9.9, §9.10, A-03, A-07.
**Acceptance:** responses ≤ 15 s P95; grounded strictly in the uploaded document; every substantive answer carries a `[Page X]` citation; an off-document question returns "I cannot find this in the document"; history persists across refresh and sessions.

**Provider:** OpenAI GPT-4o, temperature 0.4, `max_tokens` 1000, `user=<supabase_user_id>`, 20 s timeout, 3 retries. **No streaming, no Supabase Realtime (A-07)** — one request, one complete answer.

---

## 1. UI

`ChatPanel` opens **inside the results view** — the document and terms panels stay mounted — via a floating "Chat with Contract" button (desktop) or the Chat tab (tablet) / bottom sheet (mobile).

- `MessageList` — user messages right-aligned, assistant messages left-aligned; each assistant message shows its `PageCitationChip`s ("Source: Page X") which call the same `goToPage` used by the key-terms panel.
- Empty state — starter suggestions, exactly the PRD's examples: **"What happens if I breach this NDA?"** and **"Is there an auto-renewal clause?"** (the first adapts to MSA: "What happens if I breach this MSA?"). Clicking one fills the composer.
- `ChatComposer` — textarea, 1–2,000 chars, Enter sends / Shift+Enter newlines. **Disabled while awaiting a reply.** On send: an optimistic user bubble plus a typing indicator with text. At 15 s the indicator copy changes to "still reading your contract…".
- Failure: the answer bubble is replaced by the error message with a Retry action, and **the question is restored into the composer** so nothing is lost.
- `citation_verified === false` on an assistant message → an inline "unverified citation" notice under the bubble: "We couldn't confirm a page reference for this answer — check the document directly."
- New assistant messages are announced in an `aria-live="polite"` region.

---

## 2. `GET /api/contracts/{id}/chat`

Ownership verified. Selects the contract's `chat_sessions` row, **lazily inserting it if absent** (one per contract, `UNIQUE (contract_id)`). Returns up to `MAX_CHAT_HISTORY_MESSAGES` (200) messages **ascending by `created_at`**, served by `idx_chat_messages_session_created`.

**Success `200`:** `{ "session_id": "uuid", "messages": [{ "id", "role", "content", "cited_pages", "citation_verified", "created_at" }] }`

This is what makes US-012 deterministic: reopening a contract always reloads the same session.

---

## 3. `POST /api/contracts/{id}/chat`

Request `{ "message": "Is there an auto-renewal clause?" }`, 1–2,000 chars (`chatMessageSchema`).

| # | Step | Detail |
|---|---|---|
| 1 | Session + ownership | `401` / `404` |
| 2 | `contracts.status` must be `'completed'` | else `409 NOT_PROCESSED` ("Process this contract before chatting with it.") |
| 3 | Rate limit `chat`, **30/hour/user** | `429` + `Retry-After` |
| 4 | Ensure the chat session exists | lazily inserted |
| 5 | Insert the user message (`role='user'`) | persisted before the model call, so a failed turn still records the question |
| 6 | **Classify** the query locally — `contract` \| `history` \| `both` — with **no extra API call** | §4 |
| 7 | Assemble `messages[]` | §5 |
| 8 | Call GPT-4o: temp 0.4, `max_tokens` 1000, `user=<user_id>`, 20 s timeout, 3 retries with backoff | `503 AI_UNAVAILABLE` / `504 AI_TIMEOUT` |
| 9 | **Citation post-validation** with one repair retry | §6 |
| 10 | Insert the assistant message with `content`, `cited_pages`, `citation_verified`, `query_class`, `latency_ms`, `prompt_tokens`, `completion_tokens`; `UPDATE chat_sessions SET last_message_at = now()` | — |
| 11 | `activity_events` `chat_message_sent` | metadata carries `query_class` and latency only — **never** the question or answer |

**Success `200`:**
```json
{ "user_message_id": "uuid",
  "assistant_message": { "id": "uuid", "role": "assistant",
    "content": "Based on the document, the agreement auto-renews for successive 12-month terms unless either party gives 60 days' notice. [Page 4]",
    "cited_pages": [4], "citation_verified": true, "query_class": "contract",
    "latency_ms": 6120 } }
```

On `503`/`504` the user message row remains, so the conversation shows the question with a retry affordance rather than losing it.

---

## 4. `src/lib/ai/query-classifier.ts` — deterministic, zero-cost

```ts
export function classifyQuery(message: string, hasHistory: boolean): QueryClass;
```

Rules, evaluated in order:
1. **history signals** — the message references the conversation itself: `/\b(you (said|mentioned|told)|earlier|before|previous(ly)?|last (question|answer)|repeat that|what did you)\b/i`, or it is a bare back-reference (`that`, `it`, `those`) shorter than 8 words with no contract noun.
2. **contract signals** — any term-library term name, or `/\b(clause|contract|agreement|nda|msa|page|section|party|parties|liability|payment|terminat|indemnif|governing law|confidential|notice|renew)\b/i`.
3. Both matched → `both`. Only history matched **and** `hasHistory` → `history`. Otherwise → `contract` (the safe default: include the document).

**CORRECTION (2026-09-20) — the contract-signal regex above is broken as
written.** It wraps one alternation in `\b(...)\b`, mixing whole words with
prefix stems. A **trailing** `\b` makes every stem unmatchable: `terminat\b`
cannot match "termination", `indemnif\b` cannot match "indemnification", and
`renew\b` cannot match "renewal". All three stems were dead, so any question
whose only contract signal was one of those words fell through to the history
branch and **had the document body omitted from a question that needed it** —
including this spec's own worked example in §8, *"what did you say earlier about
indemnity?" → both*, which returned `history`.

Two fixes, both implemented in `src/lib/ai/query-classifier.ts` and covered by
`tests/unit/chat-logic.test.ts`:

1. **Split the alternation.** Whole words keep both boundaries; stems keep only
   the leading one:
   - `CONTRACT_WORD` = `/\b(clause|contract|agreement|nda|msa|page|section|party|parties|liability|payment|governing law|confidential|notice)\b/i`
   - `CONTRACT_STEM` = `/\b(terminat|indemni|renew)/i`
2. **`indemnif` → `indemni`**, so "indemnity" (indemnit-) matches alongside
   "indemnify" and "indemnification".

The failure was silent by construction: a misclassified turn still returns a
fluent answer, just one produced without the contract in context. Worth a
regression test on any future edit to this regex.

**SECOND CORRECTION (2026-09-20) — found by the Lab 2 Lesson 2 four-turn memory
test, run live in a browser.** Two of the four turns returned the contract
refusal. The unit tests for all four query classes were green throughout,
because they call `classifyQuery` directly and never reach the prompt the model
is actually sent.

1. **Rule 1's regex is written entirely in the second person** — `you said`,
   `what did you`. A user asking about the conversation in their own voice
   matched nothing. This spec's own §8 HISTORY example, *"What have I asked you
   so far"*, scored no history signal, classified `contract`, was answered
   against the document alone and returned "I cannot find this in the
   document." Added `HISTORY_SIGNAL_FIRST_PERSON`, covering `I/we asked|said|
   discussed`, `my questions`, `this conversation` and `so far`.

2. **Rule 3's fallback is wrong.** "Otherwise → `contract` (the safe default:
   include the document)" assumes including the document is harmless. It is
   not: the `contract` prompt also orders the model to answer ONLY from the
   document and to reply with the exact refusal when it cannot, so a classifier
   miss on a conversational question does not degrade — it refuses. The
   fallback is now: no contract signal **and** a conversation already exists →
   `both` (document *and* conversation). This costs nothing, because history is
   sent for every class; only the prompt differs. A message with a clear
   contract signal still classifies `contract`, so the class stays meaningful
   for the spec 17 evaluation.

Class `history` **omits the document body**, cutting tokens and latency for questions about the conversation itself; `contract` and `both` include it. The class is stored in `chat_messages.query_class` for evaluation.

---

## 5. Context assembly (`chat-service.ts`)

1. **System prompt** (`src/lib/ai/prompts/chat.v1.ts`), verbatim:
   > "You are ContractIQ. Answer only from the document text provided. If the answer is not in the document, reply exactly 'I cannot find this in the document.' Begin every substantive answer with 'Based on the document…'. Every answer that makes a claim about the contract must cite the page as [Page X]. Never use general legal knowledge. You cannot take any action on the contract — you only answer questions."
   For `query_class === 'history'` the prompt appends: "This question is about your earlier conversation. Answer from the conversation history; do not invent contract content."

   **CORRECTION (2026-09-20).** Composing the history prompt as BASE + this
   suffix is the second cause of the failure above. BASE says "Answer only from
   the document text provided" and, failing that, "reply exactly 'I cannot find
   this in the document.'" — while class `history` deliberately omits the
   document body (§4). The model was handed no document and an explicit
   instruction to refuse when the document does not answer; the suffix does not
   retract it. Live result: "What does that mean in practice?" classified
   `history` **correctly** and still returned the contract refusal.

   Class `history` now has its own standalone prompt with no document-only
   clause. Class `both` keeps BASE and adds permission to answer from the
   conversation, with the refusal reserved for the contract part of a question.
   Class `contract` is unchanged and still carries the spec's verbatim text, so
   grounding and the "off-document question returns the refusal" acceptance
   criterion are untouched.
2. **Full contract text** from `contracts.contract_text`, markers included, as a system-role context block — for classes `contract` and `both` only. No chunking, no vector store (valid because contracts are capped at 15,000 tokens; a chunked RAG strategy is explicitly deferred).
3. **Full conversation history**, ascending, up to **200 messages** (A-03 / Assumption 14) — this is what enables memory-style questions. If history would exceed `MAX_CHAT_HISTORY_TOKENS` (8,000), drop **oldest-first** until it fits.
4. The new user message last.

Token budget per turn: ≤ 15,000 document + ≤ ~8,000 history + ~400 system ≈ 23,400 input — well inside 128k; 1,000 output.

---

## 6. Citation enforcement

1. Parse all `[Page N]` tags with `/\[Page\s+(\d+)\]/gi`; keep unique values within `1..page_count`, sorted → `cited_pages`.
2. If the reply **is** the exact "cannot find" fallback, `citation_verified = true` and `cited_pages = []` — "not found" is a correct, expected answer, not a failure.
   **Added 2026-09-20:** the same applies to `query_class === 'history'`. An
   answer about the conversation has no page to cite, so the class-blind check
   flagged every correct history answer for repair — a second billed call whose
   only possible "fix" is a page number the model cannot have, and which would
   overwrite a correct answer with a fabricated citation if it ever produced
   one. `validateCitations` now takes the query class.
3. If the reply makes a claim and has **no** valid citation, issue **one** repair request (`repair.v1.ts`): "Your previous answer did not cite a page. Re-answer using only the document text, and cite the page as [Page X]." The repair call is logged with `purpose='repair'`.
4. If it still lacks a citation, store `citation_verified = false` and render the "unverified citation" notice. The answer is still shown — the user keeps control.
5. Citations naming a page outside `1..page_count` are discarded and count as "no citation".

---

## 7. Guardrail summary (PRD §9 chat layer)

| Control | Where |
|---|---|
| Document-only system prompt; "I cannot find this in the document" is a valid answer | `chat.v1.ts` |
| "Based on the document…" framing | `chat.v1.ts` |
| Mandatory `[Page X]`, post-validated with a repair retry | `chat-service.ts` §6 |
| Confidence is deliberately **not** surfaced in chat (only in extraction) — the framing prefix is the mitigation | UI |
| Automated hallucination regression test | `tests/ai/hallucination.spec.ts`, every deploy |

---

## 8. Tests

- `tests/unit/query-classifier.test.ts` — "what did you say earlier about indemnity?" → `both`; "repeat that" → `history`; "is there an auto-renewal clause?" → `contract`; empty history never yields `history`.
- `tests/unit/citation-parse.test.ts` — multiple tags deduped and sorted; out-of-range pages discarded; the exact fallback sentence verifies with no citation.
- `tests/ai/chat-prompt.test.ts` — snapshot: document block present for `contract`/`both`, **absent** for `history`; full history passed ascending; oldest-first truncation at the token budget.
- `tests/ai/hallucination.spec.ts` — a question about a topic absent from the fixture contract returns "I cannot find this in the document."
- `tests/integration/chat.test.ts` — `409 NOT_PROCESSED` before extraction; `GET` lazily creates the session; 201st message still returns 200 messages ascending; rate limit at 31 messages/hour; a timeout preserves the user message and returns `504`; the assistant row records `latency_ms` and token counts.
- `tests/e2e/chat-history.spec.ts` — ask → answer with a clickable citation chip that navigates the viewer → refresh → history persists.
- Eval: chat groundedness ≤ 5% hallucinated over 50 expert-reviewed Q&A pairs, monthly (spec 17).
