import { describe, expect, it } from 'vitest';
import { appError } from '@/lib/errors/app-error';

describe('NOT_FOUND noun parameterisation', () => {
  it('defaults to "contract" when no noun is supplied', () => {
    expect(appError('NOT_FOUND').userMessage).toBe("We couldn't find that contract.");
  });

  it('uses the supplied noun for a key term', () => {
    expect(appError('NOT_FOUND', { noun: 'key term' }).userMessage).toBe(
      "We couldn't find that key term.",
    );
  });

  it('keeps the 404 status and non-retryable flag either way', () => {
    const err = appError('NOT_FOUND', { noun: 'custom term' });
    expect(err.httpStatus).toBe(404);
    expect(err.retryable).toBe(false);
  });
});

describe('other interpolated codes still work', () => {
  it('interpolates FILE_TOO_LARGE', () => {
    expect(appError('FILE_TOO_LARGE', { size: '11.0' }).userMessage).toBe(
      'This file is 11.0 MB — the limit is 10 MB.',
    );
  });

  it('interpolates QUOTA_EXCEEDED', () => {
    expect(appError('QUOTA_EXCEEDED', { limit: 5, plan: 'Free Trial' }).userMessage).toBe(
      "You've used all 5 analyses on your Free Trial plan.",
    );
  });
});
