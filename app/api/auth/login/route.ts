import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, signToken } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required.' }, { status: 400 });
    }

    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    // Case-insensitive username lookup for mobile devices
    const allUsers = await prisma.user.findMany();
    const user = allUsers.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    const isValid = await verifyPassword(cleanPassword, user.passwordHash);

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    const token = await signToken({ userId: user.id, username: user.username, isAdmin: user.isAdmin });
    
    // Set HTTP-only cookie (only set secure flag if actual HTTPS request)
    const isHttps = req.headers.get('x-forwarded-proto') === 'https';
    (await cookies()).set('sonic_horizon_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    return NextResponse.json({ success: true, isAdmin: user.isAdmin, message: 'Logged in successfully.' });

  } catch (error) {
    console.error('Login Error:', error);
    return NextResponse.json({ error: 'Failed to login.' }, { status: 500 });
  }
}
