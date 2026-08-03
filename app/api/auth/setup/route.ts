import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, signToken, SESSION_MAX_AGE_SECONDS, MIN_PASSWORD_LENGTH } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const userCount = await prisma.user.count();
    
    if (userCount > 0) {
      return NextResponse.json({ error: 'Admin already initialized.' }, { status: 400 });
    }

    const { username, password } = await req.json();

    if (!username || !password || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Valid username and password required (min ${MIN_PASSWORD_LENGTH} chars).` }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: hashedPassword,
        isAdmin: true,
        mustChangePassword: false,
      }
    });

    const token = await signToken({ userId: user.id, username: user.username, isAdmin: user.isAdmin, tokenVersion: user.tokenVersion });
    
    // Set HTTP-only cookie (only set secure flag if actual HTTPS request)
    const isHttps = req.headers.get('x-forwarded-proto') === 'https';
    (await cookies()).set('sonic_horizon_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return NextResponse.json({ success: true, message: 'Admin account created.' });

  } catch (error) {
    console.error('Setup Error:', error);
    return NextResponse.json({ error: 'Failed to create admin.' }, { status: 500 });
  }
}
