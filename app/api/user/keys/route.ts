import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { encrypt } from '@/lib/encrypt';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const keys = await prisma.providerKey.findMany({
      where: { userId },
      select: { provider: true, createdAt: true },
    });
    return NextResponse.json({ providers: keys.map(k => k.provider) });
  } catch (error) {
    console.error('Keys GET error:', error);
    return NextResponse.json({ error: 'Failed to load keys' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { provider, apiKey } = await req.json();
    if (!provider || !apiKey) {
      return NextResponse.json({ error: 'Provider and API key required' }, { status: 400 });
    }

    const encryptedKey = encrypt(apiKey);
    const now = new Date();

    await prisma.providerKey.upsert({
      where: { userId_provider: { userId, provider } },
      update: { keyData: encryptedKey, updatedAt: now },
      create: { userId, provider, keyData: encryptedKey, createdAt: now, updatedAt: now },
    });

    return NextResponse.json({ success: true, provider });
  } catch (error) {
    console.error('Keys POST error:', error);
    return NextResponse.json({ error: 'Failed to save key' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { provider } = await req.json();
    await prisma.providerKey.deleteMany({ where: { userId, provider } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Keys DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 });
  }
}
