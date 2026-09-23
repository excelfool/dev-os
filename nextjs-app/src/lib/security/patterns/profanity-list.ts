/**
 * `profanity_hate` (spec 13 v1.1 §A, PRD rule 1) — SEED list.
 *
 * The operator maintains this list; it is deliberately short and ordinary.
 * Matching is whole-word and case-insensitive, so "assignment" or "Scunthorpe"
 * never match. Pattern ids are stable (`profanity.NN`) so `guardrail_events.matched`
 * never stores the word itself. Slurs and hate terms are the operator's to add,
 * under `hate.NN` ids.
 */
export const PROFANITY_LIST: Array<{ id: string; word: string }> = [
  'fuck',
  'fucking',
  'fucked',
  'fucker',
  'motherfucker',
  'shit',
  'shitty',
  'bullshit',
  'bitch',
  'bastard',
  'asshole',
  'arsehole',
  'dickhead',
  'prick',
  'piss off',
  'pissed off',
  'bollocks',
  'wanker',
  'twat',
  'cunt',
  'dumbass',
  'jackass',
  'goddamn',
  'screw you',
  'stfu',
  'wtf',
].map((word, index) => ({ id: `profanity.${String(index + 1).padStart(2, '0')}`, word }));
