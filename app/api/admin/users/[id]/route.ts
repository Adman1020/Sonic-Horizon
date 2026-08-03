import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  if (id === currentUser.userId) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  try {
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;

  try {
    const { password } = await req.json();
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);
    // Bump tokenVersion to revoke existing sessions and force a password
    // change on the user's next login.
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        tokenVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
