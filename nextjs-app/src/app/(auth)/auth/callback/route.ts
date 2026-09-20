import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/components/auth/auth-validation';

/**
 * Email-confirmation callback (spec 03 §8).
 *
 * The route group contributes no path segment, so the literal `auth` segment
 * must be in the tree or the verification link 404s. Ships regardless of
 * whether confirmation is switched on (A-05).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const safeNext = safeNextPath(searchParams.get('next'));

  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`);

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=verification_failed`);

  return NextResponse.redirect(`${origin}${safeNext}`);
}
