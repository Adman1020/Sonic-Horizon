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
    // user's current tokenVersion (revoked on session invalidation) and
    // the user must still exist (revoked on deletion).
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isAdmin: true, approved: true, tokenVersion: true },
    });
    if (!user || user.tokenVersion !== ((payload.tokenVersion as number | undefined) ?? 0)) {
      return makeRedirect('/login');
    }

    // Pending users (unknown Spotify ID awaiting admin approval) can load the
    // landing page to see the pending banner, but nothing else. API routes
    // return 403.
    if (!user.approved) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Account pending approval' }, { status: 403 });
      }
      if (pathname !== '/') {
        return makeRedirect('/?pending=1');
      }
      return NextResponse.next();
    }

    const isAdmin = Boolean(user.isAdmin);

    // Admins are real users too (the first Spotify sign-in bootstraps admin) —
    // they use the discovery app AND can manage users via /admin.
    if (!isAdmin && pathname.startsWith('/admin')) {
      return makeRedirect('/');
    }

    return NextResponse.next();
  } catch (err) {
    console.error('[proxy] session check failed:', err);
    return makeRedirect('/login');
  }
}

export const config = {
  matcher: [
    // Exclude the auth/spotify entry + callback, the login page, Next.js
    // internals, and any static file (public/ assets carry a file extension)
    // so they load without an auth cookie instead of being redirected to
    // /login. /api/spotify/auth must stay public — it's the OAuth login entry
    // point itself (the "Continue with Spotify" button).
    '/((?!api/auth|api/spotify/auth|api/spotify/callback|login|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)',
  ],
};
