import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicConfig } from '@/lib/utils/config';

/**
 * Server client bound to the caller's JWT (spec 01 §3). **RLS applies.** This
 * is the default for all row access in Server Components and Route Handlers.
 */
export function createServerSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only. The middleware refreshes the session on every matched
          // request, so the write is safe to skip here.
        }
      },
    },
  });
}
