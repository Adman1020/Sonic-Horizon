import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = process.env.JWT_SECRET || 'super-secret-fallback-key-do-not-use-in-prod';
const key = new TextEncoder().encode(secretKey);

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('sonic_horizon_token')?.value;
  const { pathname } = request.nextUrl;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  let cleanHost = host || request.nextUrl.host;
  if (cleanHost.includes('localhost')) {
    cleanHost = cleanHost.replace('localhost', '127.0.0.1');
  }
  const origin = `${proto}://${cleanHost}`.replace(/\/$/, '');
  const makeRedirect = (path: string) => NextResponse.redirect(`${origin}${path.startsWith('/') ? path : '/' + path}`);

  if (!token) {
    return makeRedirect('/login');
  }

  try {
    const { payload } = await jwtVerify(token, key);
    const isAdmin = Boolean(payload.isAdmin);

    if (isAdmin && pathname === '/') {
      return makeRedirect('/admin');
    }

    if (!isAdmin && pathname.startsWith('/admin')) {
      return makeRedirect('/');
    }

    return NextResponse.next();
  } catch {
    return makeRedirect('/login');
  }
}

export const config = {
  matcher: [
    '/((?!api/auth|api/spotify/callback|login|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
