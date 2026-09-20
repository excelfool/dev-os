/**
 * The single error taxonomy (spec 01 §2).
 *
 * `message` strings are the literal copy rendered to users — components never
 * paraphrase them. `{placeholder}` tokens are interpolated at throw time and
 * are part of each code's contract.
 */

export interface ErrorDefinition {
  httpStatus: number;
  message: string;
  retryable: boolean;
  /**
   * Default interpolation values, applied when the caller supplies none.
   * Keeps a parameterised message readable at its most common call site —
   * `appError('NOT_FOUND')` still reads "We couldn't find that contract."
   */
  defaults?: Record<string, string | number>;
}

export const ERROR_DEFINITIONS = {
  UNAUTHENTICATED: { httpStatus: 401, message: 'Please sign in to continue.', retryable: false },
  FORBIDDEN: { httpStatus: 403, message: "You don't have access to this contract.", retryable: false },
  // `{noun}` is parameterised so a key-term or custom-term miss does not say
  // "contract". Interpolation is the taxonomy's existing extension mechanism,
  // and 404 NOT_FOUND stays the single code every route may return (spec 12).
  NOT_FOUND: {
    httpStatus: 404,
    message: "We couldn't find that {noun}.",
    retryable: false,
    defaults: { noun: 'contract' },
  },
  NOT_A_PDF: { httpStatus: 400, message: "That file isn't a PDF. Please upload a PDF contract.", retryable: false },
  FILE_TOO_LARGE: { httpStatus: 413, message: 'This file is {size} MB — the limit is 10 MB.', retryable: false },
  TOO_MANY_PAGES: { httpStatus: 422, message: 'This contract is {pages} pages — the limit is 20 pages for now.', retryable: false },
  TOO_MANY_TOKENS: { httpStatus: 422, message: 'This contract is longer than we can handle right now — support for longer contracts is coming.', retryable: false },
  SCANNED_PDF: { httpStatus: 422, message: 'Scanned PDFs are not supported yet.', retryable: false },
  CORRUPT_PDF: { httpStatus: 422, message: "We couldn't read this PDF — it may be corrupted. Try re-exporting it and uploading again.", retryable: false },
  QUOTA_EXCEEDED: { httpStatus: 402, message: "You've used all {limit} analyses on your {plan} plan.", retryable: false },
  RATE_LIMITED: { httpStatus: 429, message: "You're going a bit fast — try again in {minutes} minutes.", retryable: true },
  CAPACITY: { httpStatus: 503, message: "We're handling a lot of contracts right now. Try again in a minute.", retryable: true },
  AI_UNAVAILABLE: { httpStatus: 503, message: "We couldn't reach the AI service. Try again in a few minutes.", retryable: true },
  AI_TIMEOUT: { httpStatus: 504, message: "We couldn't reach the AI service. Try again in a few minutes.", retryable: true },
  AI_INVALID_OUTPUT: { httpStatus: 502, message: 'The AI returned an unreadable result. Try again in a few minutes.', retryable: true },
  STORAGE_UNAVAILABLE: { httpStatus: 200, message: "The PDF preview isn't available for this contract — we're showing the text instead.", retryable: false },
  INVALID_TERM_NAME: { httpStatus: 400, message: 'Custom term names must be 3–60 characters.', retryable: false },
  DUPLICATE_TERM: { httpStatus: 409, message: "You've already added that term.", retryable: false },
  CUSTOM_TERM_LIMIT: { httpStatus: 422, message: '5 custom terms is the limit for now.', retryable: false },
  ALREADY_PROCESSED: { httpStatus: 409, message: 'This contract has already been processed.', retryable: false },
  ALREADY_PROCESSING: { httpStatus: 409, message: 'This contract is already being analysed.', retryable: false },
  NOT_PROCESSED: { httpStatus: 409, message: 'Process this contract before chatting with it.', retryable: false },
  NO_FILE: { httpStatus: 404, message: "The original PDF isn't available.", retryable: false },
  INVALID_VALUE: { httpStatus: 400, message: 'Enter a value between 1 and 2,000 characters.', retryable: false },
  ALREADY_SURVEYED: { httpStatus: 409, message: "Thanks — you've already given us feedback recently.", retryable: false },
  PLAN_REQUIRED: { httpStatus: 403, message: 'Export is available on the Growth and Pro plans. Upgrade to export this review.', retryable: false },
  VALIDATION: { httpStatus: 400, message: 'Some of the details you entered need fixing.', retryable: false },
  /**
   * Added by the security-foundation audit. The skill specifies
   * `400 PROMPT_INJECTION`. The copy deliberately does not say "injection
   * detected" or name the rule that fired: telling an attacker which pattern
   * blocked them is a free oracle for tuning the next attempt, and a user who
   * hits it by accident is better served by being told what the assistant is
   * for.
   */
  PROMPT_INJECTION: {
    httpStatus: 400,
    message: 'I can only answer questions about this contract. Try asking about a specific clause or term.',
    retryable: false,
  },
  INTERNAL: { httpStatus: 500, message: 'Something went wrong on our side. Please try again.', retryable: true },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

/**
 * An expired free trial has a limit of 0 and gets its own copy, so no
 * `{limit}`/`{plan}` interpolation is needed (spec 13 §5).
 */
export const TRIAL_ENDED_MESSAGE =
  'Your free trial has ended — email support@contractiq.app to choose a plan.';

/** Appended by the custom-terms routes (spec 01 §2). */
export const ALREADY_PROCESSED_CUSTOM_TERMS_SUFFIX =
  ' — custom terms can only be added beforehand.';
