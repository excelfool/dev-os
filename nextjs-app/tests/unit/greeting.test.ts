import { describe, expect, it } from 'vitest';
import { GREETING_REPLY, isGreeting } from '@/lib/ai/query-classifier';

/**
 * Spec 08 v1.1 §A step 5b — greetings and small talk get a fixed reply and
 * never reach the classifier, the enhancer, the document or the model.
 */

describe('isGreeting', () => {
  it.each([
    'hi',
    'Hello there!',
    'thanks',
    'Thank you.',
    'hey ContractIQ',
    'good morning',
    'Good evening!!',
    'ok',
    'okay.',
    'cheers',
    'how are you?',
    '  yo  ',
  ])('%j is a greeting', (message) => {
    expect(isGreeting(message)).toBe(true);
  });

  it.each([
    // A contract signal makes it a question, whatever it opens with (§E).
    'hi, is there an auto-renewal clause?',
    'thanks, and what about the notice period?',
    'hello, what is the governing law?',
    // Not the pattern: something follows the greeting.
    'hi can you help me',
    'okay so what does page 3 say',
    'thanks for that',
    // Not a greeting at all.
    'Is there an auto-renewal clause?',
    'repeat that',
    'high liability',
    '',
  ])('%j is not a greeting', (message) => {
    expect(isGreeting(message)).toBe(false);
  });

  it('the fixed reply is the spec text, verbatim', () => {
    expect(GREETING_REPLY).toBe(
      "Hi — I'm ContractIQ. Ask me anything about this contract, for example: *Is there an auto-renewal clause?*",
    );
  });
});
