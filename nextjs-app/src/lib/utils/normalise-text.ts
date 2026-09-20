/**
 * Text normalisation used by source-sentence verification (spec 06 §4) and
 * citation parsing (spec 08 §6). Deterministic and pure.
 */

const ZERO_WIDTH = /[​-‍﻿]/g;
const CURLY_SINGLE = /[‘’‚‛′]/g;
const CURLY_DOUBLE = /[“”„‟″]/g;
const DASHES = /[‐-―]/g;

/**
 * Rejoins words broken across a line break by typesetting.
 *
 * DEVIATION from spec 01 §4, which specifies only whitespace/quote/dash
 * normalisation. Verified live in Slice 4: a PDF that breaks a word across
 * lines yields "corpora\ntion" in `contract_text`, which the spec's
 * normalisation turns into "corpora tion" — so the model's verbatim
 * "corporation" fails `containsNormalised`, `is_source_verified` goes false,
 * and confidence is capped at 49. A correct extraction is then presented in the
 * red "verify this" band, which both misleads the user and distorts the
 * calibration-error metric (spec 17). Justified PDFs hyphenate routinely, so
 * this is a production concern, not a fixture artefact.
 *
 * Two cases, distinguished by the character after the break:
 *   - lowercase  => a soft hyphen from justification. Drop hyphen AND break:
 *                   "agree-\nment" -> "agreement".
 *   - anything else => a real compound that happens to break at its hyphen.
 *                   Drop the break, keep the hyphen, add no space:
 *                   "Non-\nSolicitation" -> "Non-Solicitation",
 *                   "AES-\n256" -> "AES-256".
 *
 * Runs BEFORE lower-casing: after lower-casing, "Non-\nSolicitation" would look
 * like the lowercase case and be wrongly fused into "nonsolicitation".
 */
function rejoinHyphenatedLineBreaks(text: string): string {
  return text
    .replace(/-[ \t]*\n[ \t]*([a-z])/g, '$1')
    .replace(/-[ \t]*\n[ \t]*(?=[^a-z])/g, '-');
}

/**
 * Lower-cases, collapses whitespace runs to one space, converts curly quotes
 * and en/em dashes to ASCII, strips zero-width characters, rejoins words broken
 * across line breaks, and trims.
 */
export function normalise(text: string): string {
  return rejoinHyphenatedLineBreaks(
    text.replace(ZERO_WIDTH, '').replace(/\r\n/g, '\n').replace(CURLY_SINGLE, "'").replace(CURLY_DOUBLE, '"').replace(DASHES, '-'),
  )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `needle` (normalised) occurs inside `haystack` (normalised). */
export function containsNormalised(haystack: string, needle: string): boolean {
  const n = normalise(needle);
  if (n.length === 0) return false;
  return normalise(haystack).includes(n);
}
