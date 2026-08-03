import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcrypt';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day
export const MIN_PASSWORD_LENGTH = 12;

const secretKey = process.env.JWT_SECRET;
const key = secretKey ? new TextEncoder().encode(secretKey) : null;

function getJwtKey(): Uint8Array {
  if (!key) throw new Error('JWT_SECRET environment variable is required.');
  return key;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: Record<string, unknown>) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getJwtKey());
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtKey());
    return payload;
  } catch {
    return null;
  }
}

// Read the signed-in user id, rejecting stale sessions: the token's
// tokenVersion must match the user's current one (bumped on password
// change/reset), and the user must still exist (covers deletion).
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const user = await getCurrentUserRecord();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<{ userId: string; username: string; isAdmin: boolean } | null> {
  try {
    const user = await getCurrentUserRecord();
    if (!user) return null;
    return { userId: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch {
    return null;
  }
}

async function getCurrentUserRecord(): Promise<{ id: string; username: string; isAdmin: boolean; tokenVersion: number } | null> {
  const jwtKey = getJwtKey();
  const cookieStore = await cookies();
  const token = cookieStore.get('sonic_horizon_token')?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, jwtKey);
  const userId = payload.userId as string | undefined;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, isAdmin: true, tokenVersion: true },
  });
  if (!user) return null;
  const tokenVersion = (payload.tokenVersion as number | undefined) ?? 0;
  if (user.tokenVersion !== tokenVersion) return null;
  return user;
}
