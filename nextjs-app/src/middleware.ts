import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const PROTECTED_PREFIXES = ['/dashboard', '/contracts', '/settings'];
const AUTH_ONLY_PATHS = ['/login', '/signup'];

/**
 * Layer 1 of 3 (spec 03 §3, spec 13 §1). **UX-level only** — every Route
 * Handler independently re-checks the session and RLS is the authoritative
 * gate. Neither of the first two layers is trusted alone.
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url, 307);
  }

  if (user && AUTH_ONLY_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url, 307);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets AND the two public API routes.
    // /api/health must stay reachable unauthenticated: Uptime Robot polls it
    // every minute and it is the evidence for the 99.5% uptime SLA. It must not
    // pass through updateSession (a cookie refresh on an anonymous poll is
    // wasted work and could turn a DB blip into a 500 on the health check).
    // /api/system-status is excluded only to skip a wasted cookie refresh on a
    // 60-second poll. It is NOT public: the handler re-checks the session and
    // system_status has a SELECT policy for `authenticated` only.
    '/((?!api/health|api/system-status|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
