# 16 — Design System, UX States and Accessibility

**Sources:** `docs/design.md` (token source of truth); engineering-doc §5.1, §5.4, §8.6; PRD §5 usability & compliance (WCAG 2.1 AA, plain-English jargon), §9 UI guardrails, §11 Transparency.

---

## 1. Tokens

All colour, spacing and typography values come from `docs/design.md`. Never hard-code a hex value in a component; reference the semantic token.

`tailwind.config.ts` maps the primitives to semantic names:

```ts
colors: {
  brand:   { 50:'#E7EFFC', 100:'#B6CFF5', 500:'#115ACB', 600:'#0044AE', 700:'#0D469E', 900:'#082A5E' },
  grey:    { 25:'#FAFAFA', 50:'#F0F0F1', 100:'#DADADB', 200:'#C1C2C3', 300:'#8F9193',
             400:'#5E6062', 500:'#4A4C4F', 600:'#2C2F32', 700:'#25272B', 800:'#151719', 900:'#070A0E' },
  success: { 50:'#E7F6E7', 500:'#13A10E', 600:'#11930D', 700:'#0D720A' },
  warning: { 50:'#FFF9F0', 100:'#FFF2E0', 500:'#FFAA33', 700:'#DB8000', 800:'#B36800', 900:'#854D00' },
  danger:  { 50:'#FAEBEB', 100:'#F1C0C1', 500:'#D13438', 600:'#BE2F33', 700:'#942528' },
  accent:  { 500:'#7F00FF', 700:'#6600CC' },
}
```

Voice: greyscale by default, information-forward, no decorative chrome. Colour signals **state**, never style. Primary text on white is `grey-900` (`#070A0E`).

### Confidence colours — contrast-checked

| Band | Text/icon token | Background | Contrast on white |
|---|---|---|---|
| high `≥ 80` | `success-700` `#0D720A` | `success-50` | ≥ 4.5:1 ✓ |
| medium `50–79` | `warning-900` `#854D00` | `warning-100` | ≥ 4.5:1 ✓ |
| low `< 50` | `danger-700` `#942528` | `danger-50` | ≥ 4.5:1 ✓ |

`warning-500` (`#FFAA33`) fails 4.5:1 on white and must **never** carry text — it is a fill/border only. This is why the medium band uses `warning-900` for its label.

---

## 2. Component inventory

Built from shadcn/ui (Radix underneath) — Radix provides the accessible dialog, tooltip, dropdown and focus management that the WCAG 2.1 AA requirement depends on. The full component tree is engineering-doc §5.3, reproduced in spec 00 §5; each component's behaviour is specified in the feature spec that owns it (03, 04, 05, 07, 08, 09, 10).

---

## 3. UX states (applies to every screen)

| State | Rule |
|---|---|
| **Loading** | Skeletons for dashboard cards, term rows and PDF pages. **No spinner without accompanying text.** The processing screen shows the literal three steps from the PRD. |
| **Empty** | Dashboard: "No contracts reviewed yet — upload your first contract to begin". Chat: starter-question suggestions. Terms panel: never empty after a successful run — an unfound term renders "Not found in document" at 0% confidence so the user learns what was searched for. |
| **Error** | Every error maps to a human-readable message **and a next action**. Codes and copy live in `error-codes.ts` (spec 01 §2). No silent failures. |
| **Uncaught / missing** | `src/app/error.tsx` renders "Something went wrong on our side." with a "Try again" button calling `reset()` and a link to the dashboard; it logs the digest but **never** the error's raw message to the user. `src/app/not-found.tsx` renders "We couldn't find that page." with links to the dashboard and the landing page. Neither page renders contract data. |
| **Partial / degraded** | `storage_available=false` → text viewer with an explanatory note. PDF.js render failure → text viewer + Download link. Missing chat citation → "unverified citation" notice. |
| **Responsive** | Desktop-first two-panel layout ≥ 1024 px. Tablet 768–1023 px: tabbed Document / Terms / Chat. Mobile < 768 px: single-column stack, chat as a bottom sheet, plus the advisory that large PDFs are best reviewed on desktop Chrome or Firefox. |

---

## 4. Accessibility — WCAG 2.1 AA (a CI gate, not a review item)

1. **Never colour alone.** Confidence is conveyed by **icon + text + colour** in every surface, including the exported PDF.
2. **Contrast ≥ 4.5:1** for all text and meaningful icons, verified against the tokens above in light and dark themes.
3. **Full keyboard operation** of the dropzone (Enter/Space opens the picker), the term editor (Enter saves, Esc cancels), page chips, citation chips, the "Show all terms" disclosure, the zoom controls and the chat composer.
4. **Focus management** — trapped in modals, returned to the trigger on close, and a visible focus ring everywhere (never `outline: none` without a replacement).
5. **Live regions** — `aria-live="polite"` announces processing-step changes, upload progress, new chat messages and page navigation ("Showing page 7").
6. **Accessible names** on every control; icon-only buttons carry `aria-label`.
7. **The text viewer is a first-class alternative** to the PDF canvas for screen-reader users and is announced as such, not hidden behind a failure path.
8. **Plain-English tooltips** on every piece of legal jargon in the terms panel, sourced from the term library's `tooltip` field, reachable on **focus** as well as hover (PRD §5: usable by a non-lawyer with no onboarding).
9. **Motion** — every smooth scroll, flash highlight and animation honours `prefers-reduced-motion: reduce`.
10. **axe-core runs in CI** over every page and both viewers, in light and dark themes, and **fails the build on any serious or critical violation**.

---

## 5. Onboarding tooltips (v1.0)

First-time users see three contextual, dismissible tips, each shown **once** (persisted per user in `activity_events` with `event_type='onboarding_tip_dismissed'` and the tip id in `metadata`):
1. On the upload screen — "Pick the contract type first; we tailor the terms we look for."
2. On the first results page — "Confidence tells you what to double-check. Anything under 50% gets a warning."
3. On the chat panel — "Ask in plain English. Answers come only from your document, with a page reference."

---

## 6. Required in-product copy (verbatim)

| Where | Copy |
|---|---|
| Every results page — `DisclaimerBanner` | "This is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer." |
| Every page footer | "Powered by OpenAI GPT-4o" |
| Confidence `< 50` tooltip (non-dismissible) | "Low confidence — we recommend verifying this in the document directly." |
| Scanned PDF rejection | "Scanned PDFs are not supported yet." |
| Over-length contract | "This contract is longer than we can handle right now — support for longer contracts is coming." |
| AI failure | "We couldn't reach the AI service. Try again in a few minutes." |
| Custom term cap | "5 custom terms is the limit for now." |
| Dashboard empty state | "No contracts reviewed yet — upload your first contract to begin" |
| Chat fallback answer | "I cannot find this in the document." |

**"About these results" disclosure** — on every results page and on `/trust`, stating the model's limitations exactly as the PRD asserts them: ContractIQ accurately extracts standard NDA and MSA terms from **English-language, text-layer PDFs** at ≥ 88% F1 (NDA) / ≥ 85% F1 (MSA); it **does not provide legal advice**; it **does not handle scanned PDFs**; it **does not support non-English contracts**; and it **may miss highly unusual or bespoke clauses** outside standard NDA/MSA structures. Known fairness gaps — non-US/UK conventions, South Asian, African and Latin American jurisdictions, and specialised industries such as healthcare and defence — are stated alongside, with the remediation plan (opt-in anonymised non-US data → non-US few-shot examples in v1.2).

---

## 7. Tests

- axe-core via Playwright on every route, both viewers, light and dark — zero serious/critical violations.
- `tests/e2e/keyboard.spec.ts` — the entire core flow (upload → preview → custom term → process → results → edit → chat) completed with the keyboard only.
- `tests/unit/confidence-badge.test.tsx` — icon and text are present for every band, so the component still conveys the band with colour removed.
- `tests/unit/tooltips.test.tsx` — every term library entry renders a tooltip that opens on focus.
- `tests/e2e/responsive.spec.ts` — tablet tabs and the mobile bottom-sheet chat render and function.

---

## v1.1 amendments (PRD v1.1, 2026-09-21)

### A. Required in-product copy (§6) — additions

| Where | Copy |
|---|---|
| Limitations ("About these results" and `/settings#capabilities`) — assembled from the registry, spec 21 §3 | "ContractIQ extracts standard NDA and MSA terms from English-language, text-layer PDFs. It does not provide legal advice, does not yet handle scanned PDFs or DOCX, does not support non-English contracts, does not yet flag risks, and may miss highly unusual or bespoke clauses." (clauses drop out as capabilities become `built`) |
| `RiskPanel` empty state | "Risk flags arrive in Phase 1. ContractIQ will check each contract against your playbook and cite the clause behind every flag." |
| High-severity flag label (built only) | "High risk — recommend human/legal review" |
| `EscalateOffer` stub note | "A human reviewer hand-off arrives in Phase 1." |
| Rule-3 off-scope reply | "I can only answer about this contract. Try rephrasing your question to point at a clause, a term or a page." |
| `.docx` upload | "Word documents aren't supported yet — export the contract as a PDF and upload that. DOCX support arrives in v1.1." |
| Low OCR confidence (once OCR ships) | "This scan is too low-quality to read reliably ({n}% confidence). Please upload a native digital PDF or a clearer scan." |
| `ReviewNeededNotice` | "We couldn't find {n} required term(s): {names}. Please verify these in the document before relying on this review." |
| `HIGH_FLAGS_UNDECIDED` | "Decide on each High-risk flag before marking the review complete." |
| Capability status pills | "Available now" / "In progress" / "Planned" |
| `/settings` capability section heading | "What ContractIQ can do today" |

### B. Accessibility notes

`StatusPill`, `SeverityBadge` and the disabled import options carry icon + text, never colour alone; every questionnaire code in Review mode is a `fieldset` with the verbatim question as `legend`; `aria-disabled` placeholder options are focusable and read their phase text via `aria-describedby`.

**Superseded v1.0 lines:** §3 Loading row "the literal three steps from the PRD" → the **four** PRD v1.1 steps (spec 06 v1.1 §B), the third labelled "Summarising".
