import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { hashPassword } from '@/lib/auth';

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, isAdmin: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  try {
    const { username, password } = await req.json();
    if (!username || !password || password.length < 6) {
      return NextResponse.json({ error: 'Valid username and password (min 6 chars) required' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return NextResponse.json({ error: 'Username already exists' }, { status: 409 });

    const passwordHash = await hashPassword(password);
    const now = new Date();
    const user = await prisma.user.create({
      data: { username, passwordHash, isAdmin: false, createdAt: now, updatedAt: now },
      select: { id: true, username: true, isAdmin: true, createdAt: true },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
