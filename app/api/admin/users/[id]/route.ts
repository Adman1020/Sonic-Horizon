import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

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

// Approve/reject pending users and toggle admin. Bumping tokenVersion revokes
// any live session when an account is unapproved.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const { approved, isAdmin } = await req.json().catch(() => ({}));

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Admins must stay approved; never demote the last active admin.
    if (isAdmin === false && user.isAdmin) {
      const adminCount = await prisma.user.count({ where: { isAdmin: true, approved: true } });
      if (adminCount <= 1 && !currentUser.isAdmin) {
        return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 });
      }
    }

    await prisma.user.update({
      where: { id },
      data: {
        ...(approved !== undefined && { approved: !!approved }),
        ...(isAdmin !== undefined && { isAdmin: !!isAdmin }),
        ...(approved === false && { tokenVersion: { increment: 1 } }),
        updatedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
