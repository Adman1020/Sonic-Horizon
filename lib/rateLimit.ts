// In-memory login rate limiter. This app runs as a single container, so a
// per-process Map is sufficient. Keys are per-IP and per-username.
//
// Behavior: after MAX_FAILURES failed attempts a key is locked out for
// BASE_LOCKOUT_MS. Each subsequent lockout for the same key doubles the
// duration (up to MAX_LOCKOUT_MS). Idle keys are pruned after WINDOW_MS.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOCKOUT_MS = 60 * 60 * 1000;

interface Bucket {
  failures: number;
  strikes: number;
  lockoutUntil: number;
  lastActive: number;
}

const buckets = new Map<string, Bucket>();

function prune(): void {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.lockoutUntil <= now && now - b.lastActive > WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

export function getRetryAfter(key: string): number {
  const b = buckets.get(key);
  if (!b) return 0;
  return Math.max(0, Math.ceil((b.lockoutUntil - Date.now()) / 1000));
}

export interface FailureResult {
  locked: boolean;
  retryAfter: number;
}

export function recordFailure(key: string): FailureResult {
  prune();
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { failures: 0, strikes: 0, lockoutUntil: 0, lastActive: now };
    buckets.set(key, b);
  }
  if (b.lockoutUntil > now) {
    // Still locked out — do not accumulate failures.
    return { locked: true, retryAfter: Math.ceil((b.lockoutUntil - now) / 1000) };
  }
  if (b.lockoutUntil > 0 && b.lockoutUntil <= now) {
    // Previous lockout elapsed — count an escalation strike.
    b.strikes += 1;
    b.lockoutUntil = 0;
  }
  b.failures += 1;
  b.lastActive = now;
  if (b.failures >= MAX_FAILURES) {
    const lockMs = Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * Math.pow(2, Math.min(b.strikes, 4)));
    b.lockoutUntil = now + lockMs;
    b.failures = 0;
    return { locked: true, retryAfter: Math.ceil(lockMs / 1000) };
  }
  return { locked: false, retryAfter: 0 };
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}
