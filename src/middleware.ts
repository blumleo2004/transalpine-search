import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let requests pass for next internal files, static assets, favicon, login page, and login API
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon.ico') ||
    pathname === '/login' ||
    pathname === '/api/login' ||
    pathname === '/api/keepalive'
  ) {
    return NextResponse.next();
  }

  const appPassword = process.env.APP_PASSWORD;

  // If no password is set on the server, we bypass the gate
  if (!appPassword) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get('app_session')?.value;

  // Verify the session simply by matching the stored password token
  const isValid = sessionCookie === appPassword;

  if (!isValid) {
    // If it's an API route request, respond with a JSON 401 Unauthorized
    if (pathname.startsWith('/api/')) {
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Redirect users to the login screen
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/login (auth API)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api/login|_next/static|_next/image|favicon.ico).*)',
  ],
};
