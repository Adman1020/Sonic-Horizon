import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encrypt';

export async function getDecryptedKey(userId: string, provider: string): Promise<string | null> {
  const key = await prisma.providerKey.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!key) return null;
  try {
    return decrypt(key.keyData);
  } catch {
    return null;
  }
}

export async function saveEncryptedKey(userId: string, provider: string, apiKey: string): Promise<void> {
  const encryptedKey = encrypt(apiKey);
  const now = new Date();
  await prisma.providerKey.upsert({
    where: { userId_provider: { userId, provider } },
    update: { keyData: encryptedKey, updatedAt: now },
    create: { userId, provider, keyData: encryptedKey, createdAt: now, updatedAt: now },
  });
}
