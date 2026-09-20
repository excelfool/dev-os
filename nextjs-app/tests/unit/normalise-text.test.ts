import { describe, expect, it } from 'vitest';
import { normalise, containsNormalised } from '@/lib/utils/normalise-text';

describe('normalise — de-hyphenation across line breaks', () => {
  it('rejoins a soft hyphen when the next character is lowercase', () => {
    // The Slice 4 failure case: a justified PDF breaks "corporation".
    expect(normalise('a Delaware corpora-\ntion')).toBe('a delaware corporation');
    expect(normalise('this Agree-\nment')).toBe('this agreement');
    expect(normalise('Confidential Informa-\n  tion')).toBe('confidential information');
  });

  it('keeps a real compound hyphen when the next character is not lowercase', () => {
    expect(normalise('Non-\nSolicitation')).toBe('non-solicitation');
    expect(normalise('AES-\n256')).toBe('aes-256');
    // And the unbroken forms normalise identically, which is what makes
    // verification succeed either way.
    expect(normalise('Non-\nSolicitation')).toBe(normalise('Non-Solicitation'));
    expect(normalise('AES-\n256')).toBe(normalise('AES-256'));
  });

  it('verifies a source sentence broken by hyphenation', () => {
    const contractText =
      '[PAGE 1]\nby and between Harborlight Robotics, Inc., a Delaware corpora-\ntion, and Peakside Materials Ltd.';
    const modelSentence =
      'by and between Harborlight Robotics, Inc., a Delaware corporation, and Peakside Materials Ltd.';
    expect(containsNormalised(contractText, modelSentence)).toBe(true);
  });

  it('verifies a sentence containing a compound broken at its hyphen', () => {
    const contractText = '[PAGE 2]\nThe Non-\nSolicitation period is AES-\n256 protected.';
    expect(containsNormalised(contractText, 'The Non-Solicitation period is AES-256 protected.')).toBe(
      true,
    );
  });

  it('does not fuse across a line break with no hyphen', () => {
    expect(normalise('confidential\ninformation')).toBe('confidential information');
  });
});

describe('normalise — existing behaviour is unchanged', () => {
  it('converts curly quotes and apostrophes to ASCII', () => {
    expect(normalise('the other party’s “Confidential Information”')).toBe(
      'the other party\'s "confidential information"',
    );
  });

  it('collapses whitespace runs and trims', () => {
    expect(normalise('  a   b \n\n c  ')).toBe('a b c');
  });

  it('strips zero-width characters', () => {
    expect(normalise('Effective​Date')).toBe('effectivedate');
  });

  it('converts en and em dashes to ASCII hyphens', () => {
    expect(normalise('two – three — four')).toBe('two - three - four');
  });
});

describe('containsNormalised', () => {
  it('is false for an empty needle', () => {
    expect(containsNormalised('anything', '')).toBe(false);
    expect(containsNormalised('anything', '   ')).toBe(false);
  });

  it('is false for a sentence genuinely absent from the document', () => {
    expect(containsNormalised('[PAGE 1]\nGoverning law is Delaware.', 'There is an arbitration clause.')).toBe(false);
  });
});
