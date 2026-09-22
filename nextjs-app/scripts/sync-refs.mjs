// Copies the instructor reference files the build depends on into src/, so the
// term library is generated from the reference and can never drift from it
// (spec 05 v1.1 §A). A unit test asserts byte-identity.
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pairs = [
  [
    resolve(here, '../../docs/reference/key-terms-msa-instructor.json'),
    resolve(here, '../src/lib/ai/term-library/msa-instructor.json'),
  ],
];
for (const [from, to] of pairs) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`synced ${from} -> ${to}`);
}
