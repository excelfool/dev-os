import type { GuardrailPattern } from './types';

/**
 * `no_pii_solicitation` (spec 13 v1.1 §A, PRD rule 5) — outbound only. The
 * model may state personal details that are IN the contract; it may never ask
 * the user for theirs. Every pattern therefore requires a request aimed at
 * "your", so "The Client shall provide bank details [Page 3]" is not a match.
 */
export const PII_PATTERNS: GuardrailPattern[] = [
  {
    id: 'pii.ask_contact',
    pattern:
      /\b(what(?:'s| is)|share|send|give|provide|tell me|confirm)\b[^.?!]{0,15}\byour\b[^.?!]{0,10}\b(e-?mail(?: address)?|phone(?: number)?|mobile(?: number)?|home address|address)\b/i,
    example: 'What is your email so I can follow up?',
  },
  {
    id: 'pii.ask_credentials',
    pattern: /\byour (password|passcode|log[- ]?in details|login credentials|sign[- ]?in details)\b/i,
    example: 'Please share your password so I can check the account.',
  },
  {
    id: 'pii.ask_payment',
    pattern:
      /\b(what(?:'s| is)|share|send|give|provide|tell me|enter|confirm)\b[^.?!]{0,15}\byour\b[^.?!]{0,10}\b(card number|credit card|debit card|bank details|bank account|sort code|iban)\b/i,
    example: 'Send me your card number to continue.',
  },
];
