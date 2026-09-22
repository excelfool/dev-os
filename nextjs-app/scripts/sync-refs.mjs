// Copies the instructor reference files the build depends on into src/, so the
// term library is generated from the reference and can never drift from it
// (spec 05 v1.1 §A). A unit test asserts byte-identity.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pairs = [
  [
    resolve(here, '../../docs/reference/key-terms-msa-instructor.json'),
    resolve(here, '../src/lib/ai/term-library/msa-instructor.json'),
  ],
  // Spec 22 §2: the 29 HHH codes. Review mode, the judge prompt and the sheet
  // export all read this one file, so none of them can drift from the others.
  [
    resolve(here, '../../docs/reference/hhh-questionnaire-instructor.csv'),
    resolve(here, '../eval/datasets/hhh-questionnaire.csv'),
  ],
];
for (const [from, to] of pairs) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`synced ${from} -> ${to}`);
}

// The 29 HHH codes reach the BROWSER (Review mode renders the questions), and
// a bundle cannot read a CSV off disk. The CSV stays the single source and is
// parsed here into JSON the app imports, exactly as the term library does.
const csvPath = resolve(here, '../../docs/reference/hhh-questionnaire-instructor.csv');
const jsonPath = resolve(here, '../src/lib/eval/hhh-questionnaire.json');

/** One CSV line into fields, honouring "quoted, fields". */
function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

const lines = readFileSync(csvPath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
const header = splitCsvLine(lines[0]).map((h) => h.trim());
const rows = lines.slice(1).map((line) => {
  const fields = splitCsvLine(line);
  return Object.fromEntries(header.map((name, i) => [name, (fields[i] ?? '').trim()]));
});
const codes = rows.map((r) => ({
  pillar: r.pillar,
  code: r.code,
  question: r.question,
  polarity: r.polarity,
  column: r.code.toLowerCase(),
}));

mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(codes, null, 2)}\n`);
console.log(`generated ${jsonPath} (${codes.length} codes)`);
