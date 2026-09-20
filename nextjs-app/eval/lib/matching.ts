import { normalise } from '@/lib/utils/normalise-text';

/**
 * Value matching for F1 (spec 17 §2): normalised string comparison plus
 * type-aware equivalence for dates, durations and currency amounts.
 */

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

/** "thirty-six (36) months" and "3 years" both reduce to 36 months. */
function asMonths(value: string): number | null {
  const text = normalise(value);
  // A parenthesised digit form wins: "thirty-six (36) months".
  const digits = text.match(/(\d+)\s*\)?\s*(year|month|day)/);
  const words = text.match(/([a-z-]+)\s*\(?(\d+)?\)?\s*(year|month|day)/);

  let count: number | null = null;
  let unit: string | null = null;

  if (digits) {
    count = Number(digits[1]);
    unit = digits[2]!;
  } else if (words) {
    const word = words[1]!;
    count = NUMBER_WORDS[word] ?? null;
    unit = words[3]!;
  }

  if (count === null || unit === null || Number.isNaN(count)) return null;
  if (unit === 'year') return count * 12;
  if (unit === 'month') return count;
  return count / 30;
}

/** "11 February 2025", "February 11, 2025" and "2025-02-11" all reduce alike. */
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

/** "$5,000,000", "5 million dollars" and "USD 5000000" all reduce to 5000000. */
function asCurrency(value: string): number | null {
  const text = normalise(value);
  if (!/[$£€]|usd|gbp|eur|dollar|pound|euro/.test(text)) return null;

  const millions = text.match(/([\d.]+)\s*million/);
  if (millions) return Math.round(Number(millions[1]) * 1_000_000);

  const plain = text.replace(/,/g, '').match(/([\d]+(?:\.\d+)?)/);
  return plain ? Number(plain[1]) : null;
}

export function valuesMatch(expected: string, actual: string): boolean {
  const a = normalise(expected);
  const b = normalise(actual);
  if (a === b) return true;

  // Substring either way: the model often returns a fuller clause than the
  // label, or the label is the fuller clause. Both are the same fact.
  if (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) return true;

  const months = [asMonths(expected), asMonths(actual)];
  if (months[0] !== null && months[0] === months[1]) return true;

  const dates = [asDate(expected), asDate(actual)];
  if (dates[0] !== null && dates[0] === dates[1]) return true;

  const money = [asCurrency(expected), asCurrency(actual)];
  if (money[0] !== null && money[0] === money[1]) return true;

  return false;
}
