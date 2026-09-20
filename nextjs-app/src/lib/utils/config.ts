/**
 * Public, browser-safe configuration (spec 01 §1).
 *
 * Only NEXT_PUBLIC_* values appear here. The server schema lives in
 * `server-config.ts`, which is marked `server-only` — see the note there.
 */

export const publicConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  maxUploadMb: Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 10),
  maxPages: Number(process.env.NEXT_PUBLIC_MAX_PAGES ?? 20),
  maxCustomTerms: Number(process.env.NEXT_PUBLIC_MAX_CUSTOM_TERMS ?? 5),
  emailConfirmationEnabled: process.env.NEXT_PUBLIC_EMAIL_CONFIRMATION_ENABLED === 'true',
  exportEnabled: process.env.NEXT_PUBLIC_EXPORT_ENABLED === 'true',
  statusPageUrl: process.env.NEXT_PUBLIC_STATUS_PAGE_URL ?? '',
} as const;
