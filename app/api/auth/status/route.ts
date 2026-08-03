import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    return NextResponse.json({ initialized: userCount > 0 });
  } catch (error) {
    console.error('Status Error:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
