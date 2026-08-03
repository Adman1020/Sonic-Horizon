import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, signToken, SESSION_MAX_AGE_SECONDS } from '@/lib/auth';
import { cookies } from 'next/headers';
import { recordFailure, getRetryAfter, clearFailures } from '@/lib/rateLimit';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    const cleanUsername = String(username ?? '').trim();
    const cleanPassword = String(password ?? '');
    const userKey = `user:${cleanUsername.toLowerCase()}`;

    if (!cleanUsername || !cleanPassword) {
      return NextResponse.json({ error: 'Username and password required.' }, { status: 400 });
    }

    // Rate limiting is per-username only. Every client behind Docker's NAT
    // looks like the same IP, so an IP bucket would lock everyone out when
    // one device mis-types a password.
    const userWait = getRetryAfter(userKey);
    if (userWait > 0) {
      console.warn(`[login] rate-limited before verify: username=${cleanUsername} wait=${userWait}s`);
      return NextResponse.json(
        { error: `Too many failed login attempts. Try again in ${userWait}s.` },
        { status: 429, headers: { 'Retry-After': String(userWait) } }
      );
    }

    // Case-insensitive username lookup for mobile devices
    const allUsers = await prisma.user.findMany();
    const user = allUsers.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());

    const isValid = user && (await verifyPassword(cleanPassword, user.passwordHash));

    if (!user || !isValid) {
      const res = recordFailure(userKey);
      console.warn(`[login] failed attempt: username=${cleanUsername} exists=${Boolean(user)} locked=${res.locked} pwLen=${cleanPassword.length} leadingSpace=${/^\s/.test(cleanPassword)} trailingSpace=${/\s$/.test(cleanPassword)} firstChar=${cleanPassword ? cleanPassword.charCodeAt(0) : null}`);
      if (res.locked) {
        return NextResponse.json(
          { error: `Too many failed login attempts. Try again in ${res.retryAfter}s.` },
          { status: 429, headers: { 'Retry-After': String(res.retryAfter) } }
        );
      }
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

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
