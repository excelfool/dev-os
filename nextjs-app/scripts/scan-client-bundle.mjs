#!/usr/bin/env node
/**
 * CI gate (spec 00 §6, spec 13 §9 item 2): fails the build if a server-only
 * secret name or value reaches the client bundle.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.next/static';
// Bare `sk-` matches innocent substrings (tailwind-merge ships the class name
// "mask-clip"), so the OpenAI key is matched by its actual shape instead.
const NEEDLES = [
  { label: 'SUPABASE_SERVICE_ROLE_KEY', pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
  { label: 'OPENAI_API_KEY', pattern: /OPENAI_API_KEY/ },
  // Spec 13 v1.1 §D: the retrieval.n8n bearer token (spec 21 §4 rag/).
  { label: 'N8N_RAG_TOKEN', pattern: /N8N_RAG_TOKEN/ },
  { label: 'an OpenAI key literal', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
];
for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'N8N_RAG_TOKEN']) {
  const value = process.env[name];
  if (value) {
    NEEDLES.push({
      label: `the value of ${name}`,
      pattern: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    });
  }
}

if (!existsSync(ROOT)) {
  console.error(`scan:secrets — ${ROOT} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.js')) yield full;
  }
}

const hits = [];
for (const file of walk(ROOT)) {
  const contents = readFileSync(file, 'utf8');
  for (const { label, pattern } of NEEDLES) {
    if (pattern.test(contents)) hits.push({ file, needle: label });
  }
}

if (hits.length > 0) {
  console.error('scan:secrets — FAILED. Server-only secrets found in the client bundle:');
  for (const { file, needle } of hits) console.error(`  ${file}: ${needle}`);
  process.exit(1);
}

console.log('scan:secrets — OK. No server-only secrets in the client bundle.');
