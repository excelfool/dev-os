import type { LabelledContract } from '../lib/types';

/**
 * SYNTHETIC NDAs. See eval/datasets/README.md — these are not SME-annotated and
 * not CUAD. Ground truth is known by construction because the prose was written
 * around the values.
 *
 * Three distinct drafting styles, because a single template would measure the
 * model against one phrasing and report it as accuracy. Style A is plain
 * numbered clauses; style B is a recitals-and-definitions structure with the
 * operative terms buried in prose; style C is a short-form letter agreement.
 * Each contract deliberately omits at least one term, so a false positive on an
 * absent term is measurable rather than invisible.
 */

function page(n: number, body: string): string {
  return `[PAGE ${n}]\n${body.trim()}`;
}

/** Style A — plain numbered clauses. */
function styleA(o: {
  id: string;
  partyA: string;
  partyB: string;
  effective: string;
  term: string;
  law: string;
  forum: string;
  omit: 'Non-Solicitation' | 'Permitted Disclosures';
}): LabelledContract {
  const nonSolicit =
    o.omit === 'Non-Solicitation'
      ? ''
      : `\n\n7. NON-SOLICITATION. For twelve (12) months following termination, neither party shall solicit for employment any employee of the other party with whom it had material contact.`;
  const permitted =
    o.omit === 'Permitted Disclosures'
      ? ''
      : `\n\n3. PERMITTED DISCLOSURES. A party may disclose Confidential Information to the extent required by a court of competent jurisdiction, provided it gives prompt written notice and cooperates in seeking protective treatment.`;

  return {
    contract_id: o.id,
    contract_type: 'NDA',
    jurisdiction: o.law,
    industry: 'technology',
    text: [
      page(
        1,
        `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement (this "Agreement") is entered into as of ${o.effective} (the "Effective Date") by and between ${o.partyA} and ${o.partyB} (each a "party").

1. PURPOSE. The parties wish to explore a potential commercial relationship and may disclose confidential information to one another for that purpose.

2. CONFIDENTIALITY OBLIGATIONS. Each party shall hold the other party's Confidential Information in strict confidence, shall not disclose it to any third party without prior written consent, and shall use it solely for the purpose described in clause 1.${permitted}`,
      ),
      page(
        2,
        `4. TERM. This Agreement shall continue for ${o.term} from the Effective Date, and the confidentiality obligations shall survive for a further three (3) years after any termination.

5. INTELLECTUAL PROPERTY. All Confidential Information remains the property of the disclosing party. Nothing in this Agreement grants any licence, assignment or other right in any intellectual property.

6. BREACH AND REMEDY. The parties agree that a breach of this Agreement may cause irreparable harm for which monetary damages are an inadequate remedy, and that the non-breaching party shall be entitled to seek injunctive relief.${nonSolicit}

8. GOVERNING LAW. This Agreement is governed by and construed in accordance with the laws of ${o.law}.

9. JURISDICTION. The parties submit to the exclusive jurisdiction of the courts of ${o.forum}.`,
      ),
    ].join('\n'),
    terms: [
      { term_name: 'Parties', expected_value: `${o.partyA} and ${o.partyB}`, expected_page: 1 },
      { term_name: 'Effective Date', expected_value: o.effective, expected_page: 1 },
      {
        term_name: 'Confidentiality Obligations',
        expected_value: "Hold the other party's Confidential Information in strict confidence",
        expected_page: 1,
      },
      {
        term_name: 'Permitted Disclosures',
        expected_value:
          o.omit === 'Permitted Disclosures' ? null : 'Where required by a court of competent jurisdiction',
        expected_page: o.omit === 'Permitted Disclosures' ? null : 1,
      },
      { term_name: 'Term & Duration', expected_value: o.term, expected_page: 2 },
      { term_name: 'Governing Law', expected_value: o.law, expected_page: 2 },
      { term_name: 'Jurisdiction', expected_value: o.forum, expected_page: 2 },
      {
        term_name: 'IP Ownership',
        expected_value: 'Remains the property of the disclosing party',
        expected_page: 2,
      },
      {
        term_name: 'Non-Solicitation',
        expected_value: o.omit === 'Non-Solicitation' ? null : 'Twelve (12) months following termination',
        expected_page: o.omit === 'Non-Solicitation' ? null : 2,
      },
      {
        term_name: 'Breach & Remedy',
        expected_value: 'Injunctive relief for irreparable harm',
        expected_page: 2,
      },
    ],
  };
}

/** Style B — recitals and definitions, operative terms buried in prose. */
function styleB(o: {
  id: string;
  partyA: string;
  partyB: string;
  effective: string;
  term: string;
  law: string;
  forum: string;
}): LabelledContract {
  return {
    contract_id: o.id,
    contract_type: 'NDA',
    jurisdiction: o.law,
    industry: 'life sciences',
    text: [
      page(
        1,
        `CONFIDENTIALITY AGREEMENT

THIS AGREEMENT is made on ${o.effective}

BETWEEN:

(1) ${o.partyA} ("the Disclosing Party"); and
(2) ${o.partyB} ("the Receiving Party").

RECITALS

(A) The parties are discussing a possible collaboration (the "Purpose").
(B) In the course of those discussions each party may receive information that is confidential to the other.

NOW IT IS AGREED as follows:

1. DEFINITIONS

"Confidential Information" means all information disclosed by or on behalf of one party to the other, whether before or after the date of this Agreement, which is designated as confidential or which ought reasonably to be considered confidential.`,
      ),
      page(
        2,
        `2. UNDERTAKINGS

2.1 The Receiving Party undertakes to keep the Confidential Information secret and confidential, to use it only for the Purpose, and not to disclose it to any person other than those of its officers and employees who need to know it for the Purpose.

2.2 Clause 2.1 does not apply to any disclosure required by law, by any court of competent jurisdiction or by any regulatory or governmental body, provided that the Receiving Party notifies the Disclosing Party as soon as reasonably practicable.

3. DURATION

This Agreement takes effect on the date written above and, unless terminated earlier by either party on thirty days' written notice, continues for ${o.term}.

4. PROPRIETARY RIGHTS

Nothing in this Agreement operates to transfer, or to grant any licence in respect of, any intellectual property rights in the Confidential Information, which remain vested in the Disclosing Party.

5. REMEDIES

The Receiving Party acknowledges that damages alone would not be an adequate remedy for breach and that the Disclosing Party shall be entitled to the remedies of injunction and specific performance.

6. LAW AND JURISDICTION

6.1 This Agreement and any dispute arising out of it are governed by ${o.law}.
6.2 The parties irrevocably submit to the exclusive jurisdiction of ${o.forum}.`,
      ),
    ].join('\n'),
    terms: [
      { term_name: 'Parties', expected_value: `${o.partyA} and ${o.partyB}`, expected_page: 1 },
      { term_name: 'Effective Date', expected_value: o.effective, expected_page: 1 },
      {
        term_name: 'Confidentiality Obligations',
        expected_value: 'Keep the Confidential Information secret and confidential',
        expected_page: 2,
      },
      {
        term_name: 'Permitted Disclosures',
        expected_value: 'Disclosure required by law, court or regulatory body',
        expected_page: 2,
      },
      { term_name: 'Term & Duration', expected_value: o.term, expected_page: 2 },
      { term_name: 'Governing Law', expected_value: o.law, expected_page: 2 },
      { term_name: 'Jurisdiction', expected_value: o.forum, expected_page: 2 },
      {
        term_name: 'IP Ownership',
        expected_value: 'Remain vested in the Disclosing Party',
        expected_page: 2,
      },
      // Style B has no non-solicitation clause at all.
      { term_name: 'Non-Solicitation', expected_value: null, expected_page: null },
      {
        term_name: 'Breach & Remedy',
        expected_value: 'Injunction and specific performance',
        expected_page: 2,
      },
    ],
  };
}

/** Style C — short-form letter agreement, single page, hyphenated line break. */
function styleC(o: {
  id: string;
  partyA: string;
  partyB: string;
  effective: string;
  term: string;
  law: string;
  forum: string;
}): LabelledContract {
  return {
    contract_id: o.id,
    contract_type: 'NDA',
    jurisdiction: o.law,
    industry: 'financial services',
    text: page(
      1,
      `${o.partyA}
${o.effective}

Dear Sirs,

Re: Confidentiality undertaking

In consideration of our providing you with information concerning our business, ${o.partyB} agrees as follows.

We will treat all information you provide as strictly confidential and will not disclose it to anyone outside our organisation, except where disclosure is required by applicable law or regulation. We will use the information only to evaluate the proposed trans-
action and for no other purpose.

This undertaking remains in force for ${o.term} from the date of this letter. All information remains your property and no licence or other right is granted to us in respect of it. You may seek injunctive relief in respect of any threatened breach, damages being an insufficient remedy.

This letter is governed by ${o.law} and we each submit to the exclusive jurisdiction of ${o.forum}.

Yours faithfully,
For and on behalf of ${o.partyB}`,
    ),
    terms: [
      { term_name: 'Parties', expected_value: `${o.partyA} and ${o.partyB}`, expected_page: 1 },
      { term_name: 'Effective Date', expected_value: o.effective, expected_page: 1 },
      {
        term_name: 'Confidentiality Obligations',
        expected_value: 'Treat all information as strictly confidential',
        expected_page: 1,
      },
      {
        term_name: 'Permitted Disclosures',
        expected_value: 'Where required by applicable law or regulation',
        expected_page: 1,
      },
      { term_name: 'Term & Duration', expected_value: o.term, expected_page: 1 },
      { term_name: 'Governing Law', expected_value: o.law, expected_page: 1 },
      { term_name: 'Jurisdiction', expected_value: o.forum, expected_page: 1 },
      { term_name: 'IP Ownership', expected_value: 'Remains your property', expected_page: 1 },
      { term_name: 'Non-Solicitation', expected_value: null, expected_page: null },
      {
        term_name: 'Breach & Remedy',
        expected_value: 'Injunctive relief; damages an insufficient remedy',
        expected_page: 1,
      },
    ],
  };
}

export const NDA_CORPUS: LabelledContract[] = [
  styleA({
    id: 'nda-01',
    partyA: 'Harborlight Robotics, Inc.',
    partyB: 'Peakside Materials Ltd.',
    effective: '11 February 2025',
    term: 'two (2) years',
    law: 'the State of Delaware',
    forum: 'Wilmington, Delaware',
    omit: 'Non-Solicitation',
  }),
  styleA({
    id: 'nda-02',
    partyA: 'Cobalt Analytics LLC',
    partyB: 'Verity Freight Corporation',
    effective: '3 September 2024',
    term: 'thirty-six (36) months',
    law: 'the State of New York',
    forum: 'New York County, New York',
    omit: 'Permitted Disclosures',
  }),
  styleB({
    id: 'nda-03',
    partyA: 'Ashgrove Therapeutics Limited',
    partyB: 'Northwind Diagnostics plc',
    effective: '17 June 2025',
    term: 'five (5) years',
    law: 'the laws of England and Wales',
    forum: 'the courts of England and Wales',
  }),
  styleB({
    id: 'nda-04',
    partyA: 'Meridian Bioworks GmbH',
    partyB: 'Calder Instruments Limited',
    effective: '2 January 2025',
    term: 'three (3) years',
    law: 'Scots law',
    forum: 'the Court of Session, Edinburgh',
  }),
  styleC({
    id: 'nda-05',
    partyA: 'Stonebridge Capital Partners LLP',
    partyB: 'Ivory Lane Advisory Limited',
    effective: '28 April 2025',
    term: 'eighteen (18) months',
    law: 'the laws of England and Wales',
    forum: 'the courts of England and Wales',
  }),
  styleC({
    id: 'nda-06',
    partyA: 'Fairhaven Mutual Insurance Company',
    partyB: 'Ridgeline Actuarial Services, Inc.',
    effective: '9 October 2024',
    term: 'two (2) years',
    law: 'the Commonwealth of Massachusetts',
    forum: 'Suffolk County, Massachusetts',
  }),
];
