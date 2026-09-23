/**
 * `competitor_disparagement` (spec 13 v1.1 §A, PRD rule 2) — seed list: the
 * names the PRD itself mentions. The operator maintains this list.
 */
export const COMPETITORS = ['DocuSign', 'Ironclad', 'Kira', 'ChatGPT', 'Copilot', 'Claude', 'Cowork'] as const;

/** A comparative or disparaging word; a competitor within 12 tokens of one is a match. */
export const COMPARATIVE_WORDS = ['better', 'worse', 'inferior', 'superior', 'avoid', 'scam', 'beats'] as const;

export const COMPETITOR_WINDOW_TOKENS = 12;

/** Pattern id for a competitor: `competitor.docusign`, … */
export const competitorPatternId = (name: string) => `competitor.${name.toLowerCase()}`;
