import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { runScheduledDiscovery } from '@/lib/runGeneration';
import { computeNextRun } from '@/lib/scheduler';

// Manually trigger the full scheduled pipeline (refresh signals → generate →
// push to the "Sonic Horizon" playlist). Same code path the cron uses, so a
// manual "run now" behaves identically to an on-schedule run — except it is
// allowed even when the user's schedule is off. Admins may pass { userId } in
// the body to trigger another user's discovery.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let targetUserId = user.userId;
  try {
    const body = await req.json().catch(() => null);
    const requested = (body as { userId?: unknown } | null)?.userId;
    if (typeof requested === 'string' && requested && requested !== user.userId) {
      if (!user.isAdmin) {
        return NextResponse.json({ error: 'Only admins can trigger another user\'s discovery.' }, { status: 403 });
      }
      targetUserId = requested;
    }
  } catch {
    // Non-JSON or empty body — run for the current user.
  }

  const result = await runScheduledDiscovery(targetUserId, { force: true });

  let nextRun: string | null = null;
  try {
    const settings = await prisma.settings.findUnique({ where: { userId: targetUserId } });
    if (settings?.scheduleEnabled) {
      const iso = computeNextRun(
        settings.scheduleInterval ?? 'daily',
        settings.scheduleHour ?? 8,
        settings.scheduleDay ?? 1,
      )?.toISOString();
      if (iso) nextRun = iso;
    }
  } catch {
    // nextRun is cosmetic — ignore failures.
  }

  return NextResponse.json({ ok: result.ok, message: result.message, nextRun });
}
