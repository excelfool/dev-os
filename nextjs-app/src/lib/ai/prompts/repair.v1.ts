/** JSON-repair prompt, verbatim (spec 06 §2). */
export const JSON_REPAIR_PROMPT =
  'Your previous response was not valid JSON. Return only the JSON object described, with no explanation.';

/** Citation-repair prompt, verbatim (spec 08 §6 step 3). */
export const CITATION_REPAIR_PROMPT =
  'Your previous answer did not cite a page. Re-answer using only the document text, and cite the page as [Page X].';
