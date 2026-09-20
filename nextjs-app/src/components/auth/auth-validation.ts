import { z } from 'zod';

/**
 * Client-side auth validation (spec 03 §6). Supabase Auth is called directly
 * from the browser, so there is no server counterpart to share with.
 */
export const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters, including a letter and a number.')
    .regex(/[A-Za-z]/, 'Use at least 8 characters, including a letter and a number.')
    .regex(/[0-9]/, 'Use at least 8 characters, including a letter and a number.'),
});

/** Sign-in only checks presence — the rule message belongs on sign-up. */
export const signInSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * Open-redirect guard: only a relative path beginning with `/` is honoured
 * (spec 03 §7). `//evil.com` is protocol-relative and must be rejected.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next) return fallback;

  // Browsers strip control characters before navigating, so `/\tevil.com`
  // becomes `/evil.com` — and `/\t/evil.com` becomes `//evil.com`.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;

  // Backslashes are normalised to forward slashes in URLs, so `/\evil.com`
  // navigates to //evil.com — a different origin. Checking only for a literal
  // "//" let a phishing link through the real login page and bounced the user
  // to the attacker's site after a genuine sign-in.
  const normalised = next.replace(/\\/g, '/');
  if (!normalised.startsWith('/') || normalised.startsWith('//')) return fallback;

  return next;
}
