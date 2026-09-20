import { termsFor } from '@/lib/ai/term-library';
import type { ContractType } from '@/types/domain';

/**
 * Extraction prompt, composed in the fixed order of spec 06 §2:
 * role and constraints → few-shot block → target term list → output contract
 * → grounding rules.
 *
 * The few-shot examples are what close the zero-shot→few-shot F1 gap and are
 * hard-coded here deliberately. Any change bumps the filename version AND
 * PROMPT_VERSION (spec 06 §8).
 */

const ROLE_AND_CONSTRAINTS = `You extract key terms from a single contract. Extract only from the supplied document text. Never infer from general legal knowledge. If a term is not present in the document, return \`value: null\` with a low confidence score — do not guess.`;

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
          source_sentence:
            'This Agreement is entered into as of March 14, 2024 (the "Effective Date") by and between Northwind Systems, Inc., a Delaware corporation, and Contoso Analytics Ltd., a company registered in England and Wales.',
        },
        {
          term_name: 'Effective Date',
          value: 'March 14, 2024',
          page_number: 1,
          confidence_score: 0.94,
          source_sentence:
            'This Agreement is entered into as of March 14, 2024 (the "Effective Date") by and between Northwind Systems, Inc., a Delaware corporation, and Contoso Analytics Ltd., a company registered in England and Wales.',
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
          source_sentence:
            'The obligations of confidentiality set out in Section 2 shall survive termination of this Agreement for a period of five (5) years.',
        },
        {
          term_name: 'Permitted Disclosures',
          value:
            'Disclosure permitted where required by a valid court order, with prompt written notice to the Disclosing Party',
          page_number: 2,
          confidence_score: 0.89,
          source_sentence:
            'The Receiving Party may disclose Confidential Information to the extent required by a valid court order, provided it gives prompt written notice to the Disclosing Party.',
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
          value: 'Laws of the State of New York, without regard to conflict of laws principles',
          page_number: 4,
          confidence_score: 0.95,
          source_sentence:
            'This Agreement shall be governed by the laws of the State of New York, without regard to its conflict of laws principles.',
        },
        {
          term_name: 'Non-Solicitation',
          value: null,
          page_number: null,
          confidence_score: 0.0,
          source_sentence: null,
        },
      ],
    },
  },
];

const MSA_EXAMPLES = [
  {
    excerpt: `[PAGE 1]
MASTER SERVICES AGREEMENT
Fabrikam Consulting LLC ("Supplier") will provide the professional services described in each Statement of Work executed under this Agreement to Tailspin Retail Group plc ("Client").`,
    output: {
      detected_type: 'MSA',
      terms: [
        {
          term_name: 'Parties',
          value: 'Fabrikam Consulting LLC ("Supplier") and Tailspin Retail Group plc ("Client")',
          page_number: 1,
          confidence_score: 0.95,
          source_sentence:
            'Fabrikam Consulting LLC ("Supplier") will provide the professional services described in each Statement of Work executed under this Agreement to Tailspin Retail Group plc ("Client").',
        },
        {
          term_name: 'Service Scope',
          value:
            'Professional services described in each Statement of Work executed under the Agreement',
          page_number: 1,
          confidence_score: 0.88,
          source_sentence:
            'Fabrikam Consulting LLC ("Supplier") will provide the professional services described in each Statement of Work executed under this Agreement to Tailspin Retail Group plc ("Client").',
        },
      ],
    },
  },
  {
    excerpt: `[PAGE 3]
5.2 Client shall pay each undisputed invoice within thirty (30) days of receipt. Invoices are issued monthly in arrears.
5.4 Amounts not paid when due shall accrue interest at 1.5% per month.`,
    output: {
      detected_type: 'MSA',
      terms: [
        {
          term_name: 'Payment Terms',
          value: 'Undisputed invoices payable within thirty (30) days of receipt (net 30)',
          page_number: 3,
          confidence_score: 0.94,
          source_sentence:
            'Client shall pay each undisputed invoice within thirty (30) days of receipt.',
        },
        {
          term_name: 'Invoice Schedule',
          value: 'Monthly in arrears',
          page_number: 3,
          confidence_score: 0.9,
          source_sentence: 'Invoices are issued monthly in arrears.',
        },
        {
          term_name: 'Late Payment Penalty',
          value: 'Interest at 1.5% per month on amounts not paid when due',
          page_number: 3,
          confidence_score: 0.93,
          source_sentence: 'Amounts not paid when due shall accrue interest at 1.5% per month.',
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
          term_name: 'Liability Cap',
          value:
            'Aggregate liability capped at fees paid under the applicable SOW in the preceding 12 months; excludes breaches of confidentiality and indemnification obligations',
          page_number: 6,
          confidence_score: 0.92,
          source_sentence:
            "Except for breaches of confidentiality and indemnification obligations, each party's aggregate liability shall not exceed the fees paid under the applicable Statement of Work in the twelve (12) months preceding the claim.",
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
               "source_sentence": "string|null" } ] }`;

const GROUNDING_RULES = `Grounding rules:
- page_number must be the 1-indexed page taken from the nearest preceding [PAGE N] marker in the document text.
- source_sentence must be copied verbatim from the document, character for character. Do not paraphrase, re-punctuate or shorten it.
- confidence_score is a float between 0.0 and 1.0 reflecting your own certainty.
- Return exactly one object per requested term, standard and custom, in the order the terms are listed.
- detected_type is what the document actually appears to be, which may differ from the terms you were asked to find.`;

function renderExamples(examples: typeof NDA_EXAMPLES): string {
  return examples
    .map(
      (example) =>
        `Document excerpt:\n${example.excerpt}\n\nExpected JSON:\n${JSON.stringify(example.output, null, 2)}`,
    )
    .join('\n\n---\n\n');
}

export function buildExtractionSystemPrompt(
  contractType: ContractType,
  customTermNames: string[],
): string {
  const standard = termsFor(contractType)
    .map((term) => `- ${term.term_name}: ${term.guidance}`)
    .join('\n');

  const custom =
    customTermNames.length > 0
      ? `\n\nAdditional terms the user asked for:\n${customTermNames.map((n) => `- ${n}`).join('\n')}`
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

/** The user message is the full contract_text, unmodified, markers included. */
export function buildExtractionUserMessage(contractText: string): string {
  return contractText;
}
