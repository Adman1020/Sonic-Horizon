import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcrypt';
import { cookies } from 'next/headers';

const secretKey = process.env.JWT_SECRET;
if (!secretKey) throw new Error('JWT_SECRET environment variable is required.');
const key = new TextEncoder().encode(secretKey);

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
    .setExpirationTime('7d')
    .sign(key);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, key);
    return payload;
  } catch {
    return null;
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('sonic_horizon_token')?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, key);
    return payload.userId as string;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<{ userId: string; username: string; isAdmin: boolean } | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('sonic_horizon_token')?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, key);
    return {
      userId: payload.userId as string,
      username: payload.username as string,
      isAdmin: payload.isAdmin as boolean,
    };
  } catch {
    return null;
  }
}
