import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, signToken, SESSION_MAX_AGE_SECONDS } from '@/lib/auth';
import { cookies } from 'next/headers';
import { recordFailure, getRetryAfter, clearFailures } from '@/lib/rateLimit';

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const ipKey = `ip:${ip}`;

  try {
    const { username, password } = await req.json();
    const cleanUsername = String(username ?? '').trim();
    const cleanPassword = String(password ?? '');
    const userKey = `user:${cleanUsername.toLowerCase()}`;

    if (!cleanUsername || !cleanPassword) {
      return NextResponse.json({ error: 'Username and password required.' }, { status: 400 });
    }

    const ipWait = getRetryAfter(ipKey);
    const userWait = getRetryAfter(userKey);
    if (ipWait > 0 || userWait > 0) {
      const wait = Math.max(ipWait, userWait);
      return NextResponse.json(
        { error: `Too many failed login attempts. Try again in ${wait}s.` },
        { status: 429, headers: { 'Retry-After': String(wait) } }
      );
    }

    // Case-insensitive username lookup for mobile devices
    const allUsers = await prisma.user.findMany();
    const user = allUsers.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());

    const isValid = user && (await verifyPassword(cleanPassword, user.passwordHash));

    if (!user || !isValid) {
      const res = recordFailure(ipKey);
      if (cleanUsername) recordFailure(userKey);
      if (res.locked) {
        return NextResponse.json(
          { error: `Too many failed login attempts. Try again in ${res.retryAfter}s.` },
          { status: 429, headers: { 'Retry-After': String(res.retryAfter) } }
        );
      }
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    clearFailures(ipKey);
    clearFailures(userKey);

    const token = await signToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      tokenVersion: user.tokenVersion,
    });

    // Set HTTP-only cookie (only set secure flag if actual HTTPS request)
    const isHttps = req.headers.get('x-forwarded-proto') === 'https';
    (await cookies()).set('sonic_horizon_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return NextResponse.json({
      success: true,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
      message: 'Logged in successfully.',
    });

  } catch (error) {
    console.error('Login Error:', error);
    return NextResponse.json({ error: 'Failed to login.' }, { status: 500 });
  }
}
