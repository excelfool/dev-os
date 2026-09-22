import { DEFAULT_ANSWER_FORMAT, termsFor } from '@/lib/ai/term-library';
import type { ContractType } from '@/types/domain';
import { sanitiseCustomTermName } from '@/lib/security/prompt-injection';

/**
 * Extraction prompt v2 (spec 06 v1.1 §A, PRD R-16 / R-21c), composed in the
 * fixed order of spec 06 §2: role and constraints → few-shot block → target
 * term list → output contract → grounding rules.
 *
 * v2 asks each standard term's QUESTION and constrains the value to its
 * ANSWER FORMAT — what makes answers comparable to the instructor golden set —
 * and every returned object carries a one-sentence `reasoning`.
 *
 * extraction.v1 stays in place for the eval re-baseline (spec 06 §8).
 */

export const EXTRACTION_PROMPT_VERSION = 'v2.0';
/** D47 option c: the anchor is the shortest verbatim span that holds the answer. */
export const SOURCE_ANCHOR_MAX_WORDS = 25;

const ROLE_AND_CONSTRAINTS = `You extract key terms from a single contract. Extract only from the supplied document text. Never infer from general legal knowledge. If a term is not present in the document, return \`value: null\` with a low confidence score — do not guess. For each term, answer the question exactly as a careful paralegal would, in the stated answer format. When the answer format allows \`N/A\`, use \`N/A\` only when the document does not address the term.`;

const NDA_EXAMPLES = [
  {
    excerpt: `[PAGE 1]
MUTUAL NON-DISCLOSURE AGREEMENT
This Agreement is entered into as of March 14, 2024 (the "Effective Date") by and between Northwind Systems, Inc., a Delaware corporation, and Contoso Analytics Ltd., a company registered in England and Wales.`,
    output: {
      detected_type: 'NDA',
      terms: [
        {
          term_name: 'Parties',
          value: 'Northwind Systems, Inc. (a Delaware corporation) and Contoso Analytics Ltd. (registered in England and Wales)',
          page_number: 1,
          confidence_score: 0.96,
          source_anchor:
            'by and between Northwind Systems, Inc., a Delaware corporation, and Contoso Analytics Ltd., a company registered in England and Wales.',
          reasoning:
            'The recital on page 1 names both contracting entities with their places of incorporation.',
        },
        {
          term_name: 'Effective Date',
          value: '2024-03-14',
          page_number: 1,
          confidence_score: 0.94,
          source_anchor: 'entered into as of March 14, 2024 (the "Effective Date")',
          reasoning:
            'The recital defines March 14, 2024 as the Effective Date, given here in the requested YYYY-MM-DD format.',
        },
      ],
    },
  },
  {
    excerpt: `[PAGE 2]
3. TERM. The obligations of confidentiality set out in Section 2 shall survive termination of this Agreement for a period of five (5) years.
4. PERMITTED DISCLOSURES. The Receiving Party may disclose Confidential Information to the extent required by a valid court order, provided it gives prompt written notice to the Disclosing Party.`,
    output: {
      detected_type: 'NDA',
      terms: [
        {
          term_name: 'Term & Duration',
          value: 'Confidentiality obligations survive termination for five (5) years',
          page_number: 2,
          confidence_score: 0.91,
          source_anchor:
            'shall survive termination of this Agreement for a period of five (5) years.',
          reasoning:
            'Section 3 states the survival period of the confidentiality duty, which is the duration the question asks about.',
        },
        {
          term_name: 'Permitted Disclosures',
          value:
            'Disclosure permitted where required by a valid court order, with prompt written notice to the Disclosing Party',
          page_number: 2,
          confidence_score: 0.89,
          source_anchor:
            'may disclose Confidential Information to the extent required by a valid court order, provided it gives prompt written notice',
          reasoning:
            'Section 4 is the carve-out from the non-disclosure duty, so it answers which disclosures are permitted.',
        },
      ],
    },
  },
  {
    excerpt: `[PAGE 4]
9. GOVERNING LAW. This Agreement shall be governed by the laws of the State of New York, without regard to its conflict of laws principles.`,
    output: {
      detected_type: 'NDA',
      terms: [
        {
          term_name: 'Governing Law',
          value: 'State of New York',
          page_number: 4,
          confidence_score: 0.95,
          source_anchor:
            'governed by the laws of the State of New York',
          reasoning:
            'Section 9 names New York law; the answer format asks for the jurisdiction name only.',
        },
        {
          term_name: 'Non-Solicitation',
          value: null,
          page_number: null,
          confidence_score: 0.0,
          source_anchor: null,
          reasoning: 'No clause in the supplied text restricts soliciting employees or clients.',
        },
      ],
    },
  },
];

const MSA_EXAMPLES = [
  {
    excerpt: `[PAGE 1]
MASTER SERVICES AGREEMENT
This Master Services Agreement is made effective as of 1 July 2023 between Fabrikam Consulting LLC ("Supplier") and Tailspin Retail Group plc ("Client"). Supplier will provide the professional services described in each Statement of Work executed under this Agreement.`,
    output: {
      detected_type: 'MSA',
      terms: [
        {
          term_name: 'Service Provider Name',
          value: 'Fabrikam Consulting LLC',
          page_number: 1,
          confidence_score: 0.95,
          source_anchor:
            'between Fabrikam Consulting LLC ("Supplier") and Tailspin Retail Group plc ("Client")',
          reasoning:
            'The party defined as "Supplier" is the one providing the services, so it is the service provider.',
        },
        {
          term_name: 'Customer Name',
          value: 'Tailspin Retail Group plc',
          page_number: 1,
          confidence_score: 0.95,
          source_anchor:
            'between Fabrikam Consulting LLC ("Supplier") and Tailspin Retail Group plc ("Client")',
          reasoning: 'The party defined as "Client" receives the services, so it is the customer.',
        },
        {
          term_name: 'Contract start date',
          value: '2023-07-01',
          page_number: 1,
          confidence_score: 0.93,
          source_anchor: 'made effective as of 1 July 2023',
          reasoning:
            'The agreement is stated to be effective as of 1 July 2023, given in the requested YYYY-MM-DD format.',
        },
      ],
    },
  },
  {
    excerpt: `[PAGE 3]
5.1 Supplier shall invoice Client monthly in arrears.
5.2 Client shall pay each undisputed invoice within thirty (30) days of receipt.
5.4 Amounts not paid when due shall accrue interest at 1.5% per month.`,
    output: {
      detected_type: 'MSA',
      terms: [
        {
          term_name: 'Billing frequency (monthly, quarterly, annually, other)',
          value: 'Monthly',
          page_number: 3,
          confidence_score: 0.92,
          source_anchor: 'Supplier shall invoice Client monthly in arrears.',
          reasoning: 'Clause 5.1 fixes invoicing at a monthly cadence, matching the "Monthly" option.',
        },
        {
          term_name: 'Net payment terms (Net 30, 45, 60, 75, 90, other)',
          value: 'Net 30',
          page_number: 3,
          confidence_score: 0.94,
          source_anchor:
            'Client shall pay each undisputed invoice within thirty (30) days of receipt.',
          reasoning:
            'Clause 5.2 gives the client thirty days from receipt of an invoice, which is Net 30.',
        },
        {
          term_name: 'Late Payment Charges (Yes, No, N/A)',
          value: 'Yes',
          page_number: 3,
          confidence_score: 0.93,
          source_anchor: 'Amounts not paid when due shall accrue interest at 1.5% per month.',
          reasoning: 'Clause 5.4 imposes interest on overdue amounts, so late payment attracts charges.',
        },
      ],
    },
  },
  {
    excerpt: `[PAGE 6]
11. LIMITATION OF LIABILITY. Except for breaches of confidentiality and indemnification obligations, each party's aggregate liability shall not exceed the fees paid under the applicable Statement of Work in the twelve (12) months preceding the claim.`,
    output: {
      detected_type: 'MSA',
      terms: [
        {
          term_name: 'Limitations of liability (Amount)',
          value:
            'Aggregate liability capped at the fees paid under the applicable Statement of Work in the twelve (12) months preceding the claim, excluding breaches of confidentiality and indemnification obligations',
          page_number: 6,
          confidence_score: 0.92,
          source_anchor:
            "each party's aggregate liability shall not exceed the fees paid under the applicable Statement of Work in the twelve (12) months preceding the claim",
          reasoning:
            'Section 11 states the cap on each party\'s liability and its two carve-outs, which is the amount the question asks for.',
        },
        {
          term_name: 'Termination for convenience (Yes, No, N/A)',
          value: null,
          page_number: null,
          confidence_score: 0.0,
          source_anchor: null,
          reasoning: 'The supplied text contains no clause allowing termination without cause.',
        },
      ],
    },
  },
];

const OUTPUT_CONTRACT = `Return a single JSON object with exactly this shape:
{ "detected_type": "NDA" | "MSA" | "OTHER",
  "terms": [ { "term_name": "string",
               "value": "string|null",
               "page_number": 1,
               "confidence_score": 0.0,
               "source_anchor": "string|null",
               "reasoning": "string|null" } ] }`;

const GROUNDING_RULES = `Grounding rules:
- page_number must be the 1-indexed page taken from the nearest preceding [PAGE N] marker in the document text.
- source_anchor is the shortest verbatim span (at most 25 words) that contains the answer, copied character for character from the document. Do not paraphrase or re-punctuate it; it must be findable in the text exactly as written.
- reasoning is one sentence explaining why the value answers the question, referencing the clause; never legal advice.
- confidence_score is a float between 0.0 and 1.0 reflecting your own certainty.
- Return exactly one object per requested term, standard and custom, in the order the terms are listed, using the term_name exactly as listed.
- detected_type is what the document actually appears to be, which may differ from the terms you were asked to find.`;

function renderExamples(examples: typeof NDA_EXAMPLES): string {
  return examples
    .map(
      (example) =>
        `Document excerpt:\n${example.excerpt}\n\nExpected JSON:\n${JSON.stringify(example.output, null, 2)}`,
    )
    .join('\n\n---\n\n');
}

/** Exposed for the prompt-assembly test: every example object carries reasoning. */
export const FEW_SHOT_EXAMPLES = { NDA: NDA_EXAMPLES, MSA: MSA_EXAMPLES };

export function renderTargetTerm(term: { term_name: string; question: string; answer_format: string }): string {
  return `- ${term.term_name}\n  Question: ${term.question}\n  Answer format: ${term.answer_format}`;
}

export function buildExtractionSystemPrompt(
  contractType: ContractType,
  customTermNames: string[],
  options: { standardTermNames?: string[] } = {},
): string {
  // D47 option c: a batch renders only its share of the standard terms.
  const only = options.standardTermNames ? new Set(options.standardTermNames) : null;
  const standard = termsFor(contractType)
    .filter((t) => only === null || only.has(t.term_name))
    .map(renderTargetTerm)
    .join('\n');

  const custom =
    customTermNames.length > 0
      ? `\n\nAdditional terms the user asked for:\n${customTermNames
          .map((n) => `- ${sanitiseCustomTermName(n)}\n  Answer format: ${DEFAULT_ANSWER_FORMAT}`)
          .join('\n')}`
      : '';

  return [
    ROLE_AND_CONSTRAINTS,
    `Worked examples — NDA:\n\n${renderExamples(NDA_EXAMPLES)}`,
    `Worked examples — MSA:\n\n${renderExamples(MSA_EXAMPLES)}`,
    `Extract these ${contractType} terms from the document:\n${standard}${custom}`,
    OUTPUT_CONTRACT,
    GROUNDING_RULES,
  ].join('\n\n');
}

/** The user message is the full contract_text, unmodified, markers included (see extraction.v1). */
export function buildExtractionUserMessage(contractText: string): string {
  return contractText;
}
