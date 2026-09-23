/**
 * G46: one time zone for the whole E2E run. The browsers (`timezoneId`) and the
 * app server (`TZ`) are pinned to it in playwright.config.ts, and a spec that
 * asserts a rendered date formats its expectation here, in the same zone.
 * Before this, the runner formatted "today" in the sandbox's TZ=EDT4 while the
 * browsers used UTC, so a date assertion failed every night from 20:00 EDT.
 */
export const E2E_TIMEZONE = 'UTC';

/** `d MMM yyyy` (the app's formatDate) for `date`, in E2E_TIMEZONE. */
export function formatDateInE2eZone(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: E2E_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('day')} ${part('month')} ${part('year')}`;
}
