import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';

const secretKey = process.env.JWT_SECRET;
const key = secretKey ? new TextEncoder().encode(secretKey) : null;

function getJwtKey(): Uint8Array {
  if (!key) throw new Error('JWT_SECRET environment variable is required.');
  return key;
}

export async function proxy(request: NextRequest) {
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
    const { payload } = await jwtVerify(token, getJwtKey());
    const userId = payload.userId as string | undefined;
    if (!userId) return makeRedirect('/login');

    // Check the session against the database: the token must match the
    // user's current tokenVersion (revoked on password change/reset) and
    // the user must still exist (revoked on deletion).
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isAdmin: true, tokenVersion: true, mustChangePassword: true },
    });
    if (!user || user.tokenVersion !== ((payload.tokenVersion as number | undefined) ?? 0)) {
      return makeRedirect('/login');
    }

    // Users flagged mustChangePassword are locked down until they set a new
    // password. Pages redirect to /change-password; API routes (other than
    // /api/auth, which the matcher already excludes) return 403.
    if (user.mustChangePassword) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Password change required' }, { status: 403 });
      }
      if (pathname !== '/change-password') {
        return makeRedirect('/change-password?forced=1');
      }
      return NextResponse.next();
    }

    const isAdmin = Boolean(user.isAdmin);

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
    // Exclude auth/spotify callback, the login page, Next.js internals, and
    // any static file (public/ assets carry a file extension) so they load
    // without an auth cookie instead of being redirected to /login.
    '/((?!api/auth|api/spotify/callback|login|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)',
  ],
};
