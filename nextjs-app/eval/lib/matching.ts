import { normalise } from '@/lib/utils/normalise-text';

/**
 * Value matching for F1 (spec 17 §2), versioned.
 *
 * The matcher is versioned because it is the instrument, and changing an
 * instrument changes every number it produces. A report stamped `matcher: v1`
 * and one stamped `v2` are not comparable as model results; the per-row
 * `Notes` column records WHICH rule matched, so a reader can see how much of a
 * score came from the loosest rule rather than from the model.
 *
 * v1 — the matcher the first measurement (2026-09-20) was taken with.
 * v2 — adds defined-term stripping and content-token subset matching, after
 *      all 30 failing rows of that run turned out to be correct extractions
 *      rejected on phrasing.
 */

export type MatcherVersion = 'v1' | 'v2';

export type MatchRule =
  | 'exact'
  | 'substring'
  | 'duration'
  | 'date'
  | 'currency'
  | 'defined-terms'
  | 'token-subset'
  | 'none';

export interface MatchResult {
  matched: boolean;
  rule: MatchRule;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18, twenty: 20,
  'twenty-four': 24, thirty: 30, 'thirty-six': 36, forty: 40, fifty: 50,
  sixty: 60, ninety: 90,
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

function asMonths(value: string): number | null {
  const text = normalise(value);
  const digits = text.match(/(\d+)\s*\)?\s*(year|month|day)/);
  const words = text.match(/([a-z-]+)\s*\(?(\d+)?\)?\s*(year|month|day)/);

  let count: number | null = null;
  let unit: string | null = null;

  if (digits) {
    count = Number(digits[1]);
    unit = digits[2]!;
  } else if (words) {
    count = NUMBER_WORDS[words[1]!] ?? null;
    unit = words[3]!;
  }

  if (count === null || unit === null || Number.isNaN(count)) return null;
  if (unit === 'year') return count * 12;
  if (unit === 'month') return count;
  return count / 30;
}

function asDate(value: string): string | null {
  const text = normalise(value);

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = text.match(/(\d{1,2})\s+([a-z]+),?\s+(\d{4})/);
  if (dmy && MONTHS[dmy[2]!]) {
    return `${dmy[3]}-${String(MONTHS[dmy[2]!]).padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  }

  const mdy = text.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (mdy && MONTHS[mdy[1]!]) {
    return `${mdy[3]}-${String(MONTHS[mdy[1]!]).padStart(2, '0')}-${mdy[2]!.padStart(2, '0')}`;
  }

  return null;
}

function asCurrency(value: string): number | null {
  const text = normalise(value);
  if (!/[$£€]|usd|gbp|eur|dollar|pound|euro/.test(text)) return null;

  const millions = text.match(/([\d.]+)\s*million/);
  if (millions) return Math.round(Number(millions[1]) * 1_000_000);

  const plain = text.replace(/,/g, '').match(/([\d]+(?:\.\d+)?)/);
  return plain ? Number(plain[1]) : null;
}

/** Shared by both versions. */
function coreRules(expected: string, actual: string): MatchRule | null {
  const a = normalise(expected);
  const b = normalise(actual);
  if (a === b) return 'exact';
  if (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) return 'substring';

  const months = [asMonths(expected), asMonths(actual)];
  if (months[0] !== null && months[0] === months[1]) return 'duration';

  const dates = [asDate(expected), asDate(actual)];
  if (dates[0] !== null && dates[0] === dates[1]) return 'date';

  const money = [asCurrency(expected), asCurrency(actual)];
  if (money[0] !== null && money[0] === money[1]) return 'currency';

  return null;
}

// ---------------------------------------------------------------------------
// v2 additions
// ---------------------------------------------------------------------------

/**
 * Drops parenthetical defined terms and quoted labels: contracts introduce
 * parties as `Ashgrove Therapeutics Limited ("the Disclosing Party")`, and the
 * model quotes that faithfully while a label carries the bare names.
 */
function stripDefinedTerms(value: string): string {
  return value
    .replace(/\((?:the\s+)?["“”'][^)]*\)/gi, ' ')
    .replace(/\([^)]*["“”'][^)]*\)/g, ' ')
    .replace(/["“”']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'by', 'with',
  'from', 'that', 'this', 'these', 'those', 'is', 'are', 'be', 'been', 'shall',
  'may', 'must', 'will', 'any', 'all', 'as', 'at', 'it', 'its', 'their', 'our',
  'your', 'his', 'her', 'party', 'parties', 'agreement', 'clause', 'under',
  'upon', 'where', 'which', 'who', 'whom', 'not', 'no', 'other', 'such',
  'each', 'both', 'than', 'then', 'there', 'here', 'into', 'out', 'over',
  'per', 'said', 'set', 'full', 'made', 'make', 'give', 'given',
  // Prepositions and connectives that carry no fact on their own. A label
  // reading "indemnifies Customer AGAINST third-party claims" and a quote
  // reading "indemnify ... FROM any third-party claim" state one fact.
  'against', 'between', 'before', 'after', 'during', 'within', 'unless',
  'provided', 'accordance', 'respect',
]);

function contentTokens(value: string): string[] {
  return normalise(stripDefinedTerms(value))
    .split(/[^a-z0-9£$€.%-]+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/**
 * A deliberately small stemmer. Contract prose inflects the same verb across
 * drafting styles — "indemnifies" / "indemnify", "infringement" / "infringe",
 * "assigns" / "assign" — and a prefix rule cannot bridge the y→ie change.
 */
function stem(token: string): string {
  let out = token;
  if (out.length > 4 && out.endsWith('ies')) out = `${out.slice(0, -3)}y`;
  else if (out.length > 4 && out.endsWith('es')) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith('s') && !out.endsWith('ss')) out = out.slice(0, -1);

  for (const suffix of ['ments', 'ment', 'ing', 'ed']) {
    if (out.length > suffix.length + 4 && out.endsWith(suffix)) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  return out;
}

/** "indemnifies"/"indemnify" and "infringement"/"infringe" are one token. */
function tokensAgree(left: string, right: string): boolean {
  if (left === right) return true;
  // Numbers must agree exactly — "2,000,000" must never satisfy "5,000,000",
  // and no stemming or prefix rule is ever applied to them.
  if (/\d/.test(left) || /\d/.test(right)) return false;

  const a = stem(left);
  const b = stem(right);
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 5 && longer.startsWith(shorter);
}

function isSubset(needles: string[], haystack: string[]): boolean {
  if (needles.length === 0) return false;
  return needles.every((needle) => haystack.some((token) => tokensAgree(needle, token)));
}

export function matchValues(
  expected: string,
  actual: string,
  version: MatcherVersion = 'v2',
): MatchResult {
  const core = coreRules(expected, actual);
  if (core) return { matched: true, rule: core };
  if (version === 'v1') return { matched: false, rule: 'none' };

  const strippedCore = coreRules(stripDefinedTerms(expected), stripDefinedTerms(actual));
  if (strippedCore) return { matched: true, rule: 'defined-terms' };

  // Either side's content words being wholly contained in the other means the
  // same fact stated at a different length. Both directions count: the model
  // often quotes the fuller clause, and sometimes summarises it.
  const expectedTokens = contentTokens(expected);
  const actualTokens = contentTokens(actual);
  if (isSubset(expectedTokens, actualTokens) || isSubset(actualTokens, expectedTokens)) {
    return { matched: true, rule: 'token-subset' };
  }

  return { matched: false, rule: 'none' };
}

/** Back-compat for callers that only need the boolean. */
export function valuesMatch(expected: string, actual: string, version: MatcherVersion = 'v2'): boolean {
  return matchValues(expected, actual, version).matched;
}
