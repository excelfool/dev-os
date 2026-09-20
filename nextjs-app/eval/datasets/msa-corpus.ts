import type { LabelledContract } from '../lib/types';

/**
 * SYNTHETIC MSAs. Same caveat as the NDA corpus — see eval/datasets/README.md.
 * Two drafting styles: a US-style numbered agreement and a UK-style framework
 * agreement with a schedule. Each omits at least one term.
 */

function page(n: number, body: string): string {
  return `[PAGE ${n}]\n${body.trim()}`;
}

function usStyle(o: {
  id: string;
  customer: string;
  supplier: string;
  scope: string;
  payment: string;
  invoice: string;
  latePenalty: string | null;
  cap: string;
  termination: string;
  law: string;
  dispute: string;
  notice: string;
}): LabelledContract {
  const late = o.latePenalty
    ? `\n\n5. LATE PAYMENT. Undisputed amounts not paid when due shall accrue interest at ${o.latePenalty}.`
    : '';

  return {
    contract_id: o.id,
    contract_type: 'MSA',
    jurisdiction: o.law,
    industry: 'technology',
    text: [
      page(
        1,
        `MASTER SERVICES AGREEMENT

This Master Services Agreement is entered into by and between ${o.customer} ("Customer") and ${o.supplier} ("Supplier").

1. SERVICES. Supplier shall provide ${o.scope}, as further described in one or more Statements of Work executed under this Agreement.

2. STATEMENTS OF WORK. Each Statement of Work shall be governed by this Agreement. In the event of conflict, this Agreement controls except where the Statement of Work expressly states otherwise.

3. FEES AND PAYMENT. Customer shall pay all undisputed invoiced amounts ${o.payment}.

4. INVOICING. Supplier shall invoice ${o.invoice}.${late}`,
      ),
      page(
        2,
        `6. INTELLECTUAL PROPERTY. All deliverables created specifically for Customer under a Statement of Work shall be owned by Customer upon payment in full. Supplier retains all right, title and interest in its pre-existing materials and tooling.

7. LIMITATION OF LIABILITY. Except for breach of confidentiality, indemnification obligations and gross negligence, each party's aggregate liability arising out of this Agreement shall not exceed ${o.cap}.

8. INDEMNIFICATION. Supplier shall defend, indemnify and hold harmless Customer from any third-party claim alleging that the deliverables infringe any patent, copyright or trade secret.

9. TERMINATION. Either party may terminate this Agreement ${o.termination}.

10. NOTICES. Any notice under this Agreement shall be in writing and delivered ${o.notice}.

11. GOVERNING LAW. This Agreement shall be governed by the laws of ${o.law}.

12. DISPUTE RESOLUTION. ${o.dispute}`,
      ),
    ].join('\n'),
    terms: [
      { term_name: 'Parties', expected_value: `${o.customer} and ${o.supplier}`, expected_page: 1 },
      { term_name: 'Service Scope', expected_value: o.scope, expected_page: 1 },
      { term_name: 'Payment Terms', expected_value: o.payment, expected_page: 1 },
      { term_name: 'Invoice Schedule', expected_value: o.invoice, expected_page: 1 },
      {
        term_name: 'Late Payment Penalty',
        expected_value: o.latePenalty,
        expected_page: o.latePenalty ? 1 : null,
      },
      { term_name: 'Liability Cap', expected_value: o.cap, expected_page: 2 },
      {
        term_name: 'Indemnification',
        expected_value: 'Supplier indemnifies Customer against third-party infringement claims',
        expected_page: 2,
      },
      {
        term_name: 'IP Ownership',
        expected_value: 'Deliverables owned by Customer on payment; Supplier retains pre-existing materials',
        expected_page: 2,
      },
      { term_name: 'Termination Clause', expected_value: o.termination, expected_page: 2 },
      { term_name: 'Governing Law', expected_value: o.law, expected_page: 2 },
      { term_name: 'Dispute Resolution', expected_value: o.dispute, expected_page: 2 },
      { term_name: 'Notice Period', expected_value: o.notice, expected_page: 2 },
    ],
  };
}

function ukStyle(o: {
  id: string;
  customer: string;
  supplier: string;
  scope: string;
  payment: string;
  invoice: string;
  cap: string;
  termination: string;
  law: string;
  dispute: string;
}): LabelledContract {
  return {
    contract_id: o.id,
    contract_type: 'MSA',
    jurisdiction: o.law,
    industry: 'public sector',
    text: [
      page(
        1,
        `FRAMEWORK AGREEMENT FOR THE SUPPLY OF SERVICES

DATED and made BETWEEN ${o.customer} (the "Client") and ${o.supplier} (the "Supplier").

BACKGROUND

The Client wishes to procure services of the kind described in Schedule 1, and the Supplier is willing to supply them on the terms of this Framework Agreement.

AGREED TERMS

1. SUPPLY OF SERVICES

1.1 The Supplier shall supply ${o.scope} in accordance with each Order placed under this Framework Agreement.
1.2 The Supplier shall perform the Services with reasonable skill and care and in accordance with good industry practice.

2. CHARGES AND PAYMENT

2.1 The Client shall pay the Charges ${o.payment}.
2.2 The Supplier shall submit invoices ${o.invoice}.`,
      ),
      page(
        2,
        `3. INTELLECTUAL PROPERTY RIGHTS

3.1 The Supplier assigns to the Client all Intellectual Property Rights in the Deliverables created under an Order, with effect from payment of the relevant Charges.
3.2 The Supplier retains all Intellectual Property Rights in its Background IP.

4. LIMITATION OF LIABILITY

4.1 Nothing in this Framework Agreement limits liability for death or personal injury caused by negligence or for fraud.
4.2 Subject to clause 4.1, the Supplier's total liability in respect of all claims shall not exceed ${o.cap}.

5. TERMINATION

5.1 Either party may terminate this Framework Agreement ${o.termination}.

6. GOVERNING LAW AND DISPUTES

6.1 This Framework Agreement is governed by ${o.law}.
6.2 ${o.dispute}`,
      ),
    ].join('\n'),
    terms: [
      { term_name: 'Parties', expected_value: `${o.customer} and ${o.supplier}`, expected_page: 1 },
      { term_name: 'Service Scope', expected_value: o.scope, expected_page: 1 },
      { term_name: 'Payment Terms', expected_value: o.payment, expected_page: 1 },
      { term_name: 'Invoice Schedule', expected_value: o.invoice, expected_page: 1 },
      // No late-payment clause in this style.
      { term_name: 'Late Payment Penalty', expected_value: null, expected_page: null },
      { term_name: 'Liability Cap', expected_value: o.cap, expected_page: 2 },
      // No indemnity clause in this style.
      { term_name: 'Indemnification', expected_value: null, expected_page: null },
      {
        term_name: 'IP Ownership',
        expected_value: 'Assigned to the Client on payment; Supplier retains Background IP',
        expected_page: 2,
      },
      { term_name: 'Termination Clause', expected_value: o.termination, expected_page: 2 },
      { term_name: 'Governing Law', expected_value: o.law, expected_page: 2 },
      { term_name: 'Dispute Resolution', expected_value: o.dispute, expected_page: 2 },
      // No notice clause in this style.
      { term_name: 'Notice Period', expected_value: null, expected_page: null },
    ],
  };
}

export const MSA_CORPUS: LabelledContract[] = [
  usStyle({
    id: 'msa-01',
    customer: 'Brightwater Logistics, Inc.',
    supplier: 'Quillon Software Services LLC',
    scope: 'software development and maintenance services',
    payment: 'within thirty (30) days of receipt of invoice',
    invoice: 'monthly in arrears',
    latePenalty: '1.5% per month',
    cap: 'the total fees paid in the twelve (12) months preceding the claim',
    termination: 'for convenience on sixty (60) days written notice',
    law: 'the State of California',
    dispute: 'Any dispute shall be resolved by binding arbitration in San Francisco under the rules of the American Arbitration Association.',
    notice: 'by certified mail or nationally recognised overnight courier',
  }),
  usStyle({
    id: 'msa-02',
    customer: 'Aldergate Retail Group, Inc.',
    supplier: 'Thorne Data Systems, Inc.',
    scope: 'data migration, hosting and support services',
    payment: 'within forty-five (45) days of the invoice date',
    invoice: 'quarterly in advance',
    latePenalty: null,
    cap: 'two million dollars ($2,000,000)',
    termination: 'for material breach not cured within thirty (30) days of written notice',
    law: 'the State of Texas',
    dispute: 'The parties shall first attempt mediation in Dallas, Texas before commencing litigation.',
    notice: 'by email to the addresses set out in the Statement of Work, with confirmation of receipt',
  }),
  ukStyle({
    id: 'msa-03',
    customer: 'Kestrel Borough Council',
    supplier: 'Lindhurst Professional Services Limited',
    scope: 'highways consultancy and design services',
    payment: 'within 30 days of receipt of a valid invoice',
    invoice: 'monthly, supported by a timesheet report',
    cap: '£1,000,000 in aggregate',
    termination: 'on three months written notice, or immediately on insolvency',
    law: 'the laws of England and Wales',
    dispute: 'The parties shall refer any dispute to adjudication in accordance with the Scheme for Construction Contracts.',
  }),
  ukStyle({
    id: 'msa-04',
    customer: 'Tamar Valley NHS Foundation Trust',
    supplier: 'Coriander Clinical Informatics Ltd',
    scope: 'clinical coding and information governance services',
    payment: 'within 45 days of receipt of a valid invoice',
    invoice: 'monthly in arrears against agreed milestones',
    cap: 'the Charges paid in the preceding 12 months',
    termination: 'on six months written notice',
    law: 'the laws of England and Wales',
    dispute: 'The parties shall escalate any dispute to their respective directors before commencing proceedings.',
  }),
];
