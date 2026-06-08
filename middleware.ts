import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './src/auth/constants';

// Public paths anyone can hit unauthenticated. Everything else under the
// app requires a valid session cookie. We DON'T validate the session
// against the DB here (middleware runs on the edge) — the server pages
// re-check via getCurrentSession() and bounce to /login on null. This
// middleware is just a cheap pre-filter that keeps the unauthenticated
// surface area small.
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/signup',
  '/_next',
  '/favicon',
  '/api/health-check',
];

function isPublic(pathname: string): boolean {
  // Root is the marketing landing — public. Server component redirects
  // authed users from there to /health.
  if (pathname === '/') return true;
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Preserve the original destination so loginAction can bounce back.
    if (pathname !== '/' && pathname !== '/login') {
      url.searchParams.set('next', pathname + req.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Matcher — skip Next internals + the public auth surface. The middleware
// itself still re-checks because matcher is patterns-only and we want a
// single source of truth in isPublic().
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logout).*)',
  ],
};
