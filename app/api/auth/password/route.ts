import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId, verifyPassword, hashPassword, signToken, SESSION_MAX_AGE_SECONDS, MIN_PASSWORD_LENGTH } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { currentPassword, newPassword } = await req.json().catch(() => ({}));

  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
  }
  if (typeof currentPassword !== 'string' || currentPassword === newPassword) {
    return NextResponse.json({ error: 'New password must be different from your current password' }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });

    const passwordHash = await hashPassword(newPassword);
    const newTokenVersion = user.tokenVersion + 1;

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, tokenVersion: newTokenVersion, updatedAt: new Date() },
    });

    // Reissue a session with the bumped tokenVersion so the user stays
    // signed in while all older sessions are revoked.
    const token = await signToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      tokenVersion: newTokenVersion,
    });

    const isHttps = req.headers.get('x-forwarded-proto') === 'https';
    (await cookies()).set('sonic_horizon_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return NextResponse.json({ success: true, message: 'Password updated.' });
  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }
}
