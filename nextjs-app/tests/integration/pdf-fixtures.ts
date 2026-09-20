/**
 * Minimal PDF writer for fixtures. Wraps on WORD boundaries, as a real typeset
 * PDF does — a fixture that splits words mid-word produces text that cannot be
 * source-verified, which caused a false failure in Slice 4.
 */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line.length === 0) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function makePdf(text: string, linesPerPage = 46): Buffer {
  const lines = wrap(text, 88);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
  if (pages.length === 0) pages.push(['']);

  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: Record<number, number> = {};
  const size = () => chunks.reduce((n, c) => n + c.length, 0);

  const add = (num: number, content: string) => {
    offsets[num] = size();
    chunks.push(`${num} 0 obj\n${content}\nendobj\n`);
  };

  const firstPageObj = 4;
  const pageIds = pages.map((_, i) => firstPageObj + i);
  const contentIds = pages.map((_, i) => firstPageObj + pages.length + i);

  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  add(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pages.forEach((_, i) => {
    add(
      pageIds[i]!,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
    );
  });

  pages.forEach((pageLines, i) => {
    let body = 'BT /F1 10 Tf 12 TL 56 760 Td\n';
    for (const line of pageLines) body += `(${escape(line)}) Tj T*\n`;
    body += 'ET';
    add(contentIds[i]!, `<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  });

  const xrefPos = size();
  const maxObj = Math.max(...Object.keys(offsets).map(Number)) + 1;
  let xref = `xref\n0 ${maxObj}\n0000000000 65535 f \n`;
  for (let n = 1; n < maxObj; n += 1) {
    xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  chunks.push(xref);
  chunks.push(`trailer\n<< /Size ${maxObj} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return Buffer.from(chunks.join(''), 'latin1');
}

export const SHORT_NDA_TEXT = `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement is entered into as of 11 February 2025 (the "Effective Date") by and between Harborlight Robotics, Inc., a Delaware corporation, and Peakside Materials Ltd., a company registered in England and Wales.

1. CONFIDENTIALITY. Each party shall keep the other party's Confidential Information strictly confidential and shall use it solely to evaluate a potential commercial relationship.

2. PERMITTED DISCLOSURES. A party may disclose Confidential Information where required by a valid court order, provided it gives prompt written notice to the disclosing party.

3. TERM. This Agreement runs for two (2) years from the Effective Date, and the confidentiality obligations survive for a further three (3) years after termination.

4. INTELLECTUAL PROPERTY. All Confidential Information remains the property of the disclosing party. No licence is granted under this Agreement.

5. GOVERNING LAW. This Agreement is governed by the laws of the State of Delaware.

6. JURISDICTION. The parties submit to the exclusive jurisdiction of the courts located in Wilmington, Delaware.

7. REMEDIES. The parties agree that a breach may cause irreparable harm for which damages alone are inadequate, and that injunctive relief shall be available.`;

export const SHORT_NDA = makePdf(SHORT_NDA_TEXT);

/** Above the 20-page limit. */
export const LONG_PDF = makePdf(
  Array.from({ length: 1200 }, (_, i) => `Clause ${i} of this deliberately long agreement document.`).join('\n'),
);

/** Under the 100-word floor, so it reads as a scanned PDF. */
export const SCANNED_PDF = makePdf('Short agreement. Only a handful of words here. Not enough text.');

export const NOT_A_PDF = Buffer.from('this is definitely not a pdf', 'utf8');

/** Truncated mid-structure. */
export const CORRUPT_PDF = SHORT_NDA.subarray(0, 400);
