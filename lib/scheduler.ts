// In-process cron scheduler for the "Scheduled Refreshes" feature. Boots from
// the root instrumentation.ts (register) and is kept in sync whenever a user
// toggles scheduling via the settings PUT route (resyncScheduler).
//
// One node-cron task per user with scheduleEnabled=true. Cron runs in the
// server's local timezone (set TZ in the container to choose one — UTC by
// default). Each tick runs the same lib/runGeneration pipeline a manual run
// uses, so scheduled output is byte-for-byte identical to the app.

import cron from 'node-cron';
import { prisma } from '@/lib/prisma';
import { runScheduledDiscovery } from '@/lib/runGeneration';

type CronTask = ReturnType<typeof cron.schedule>;

const globalForScheduler = globalThis as unknown as {
  scheduler: { started: boolean; jobs: Map<string, CronTask> } | undefined;
};

function state(): { started: boolean; jobs: Map<string, CronTask> } {
  if (!globalForScheduler.scheduler) {
    globalForScheduler.scheduler = { started: false, jobs: new Map() };
  }
  return globalForScheduler.scheduler;
}

export type ScheduleInterval = 'daily' | 'weekly' | 'monthly';

// Maps the settings trio to a cron expression. scheduleHour is 0-23.
// scheduleDay is 1-7 (Mon=1..Sun=7) for weekly and 1-31 for monthly.
export function buildCronExpression(interval: string, hour: number, day: number): string {
  const safeHour = Math.min(23, Math.max(0, Math.floor(hour) || 0));
  switch (interval) {
    case 'weekly':
      return `0 ${safeHour} * * ${Math.min(7, Math.max(1, Math.floor(day) || 1))}`;
    case 'monthly':
      return `0 ${safeHour} ${Math.min(28, Math.max(1, Math.floor(day) || 1))} * *`;
    case 'daily':
    default:
      return `0 ${safeHour} * * *`;
  }
}

// Next scheduled fire time, computed from the same interval/hour/day that
// buildCronExpression turns into a cron line. "Monthly" skips months whose day
// doesn't exist (e.g. day 31 in April) exactly like cron would.
export function computeNextRun(
  interval: string,
  hour: number,
  day: number,
  from: Date = new Date(),
): Date | null {
  const safeHour = Math.min(23, Math.max(0, Math.floor(hour) || 0));
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);

  for (let guard = 0; guard < 500; guard++) {
    candidate.setHours(safeHour, 0, 0, 0);

    if (interval === 'monthly') {
      const targetDay = Math.min(28, Math.max(1, Math.floor(day) || 1));
      candidate.setDate(1);
      candidate.setMonth(candidate.getMonth() + 1);
      const daysInMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
      candidate.setDate(Math.min(targetDay, daysInMonth));
      if (candidate.getTime() > from.getTime()) return candidate;
    } else if (interval === 'weekly') {
      // JS getDay(): 0=Sun..6=Sat. Our day param is Mon=1..Sun=7.
      const targetWeekday = (Math.min(7, Math.max(1, Math.floor(day) || 1)) % 7); // Mon=1 → 1, Sun=7 → 0
      const current = candidate.getDay();
      let delta = (targetWeekday - current + 7) % 7;
      if (delta === 0 && candidate.getTime() <= from.getTime()) delta = 7;
      candidate.setDate(candidate.getDate() + delta);
      if (candidate.getTime() > from.getTime()) return candidate;
    } else {
      candidate.setDate(candidate.getDate() + 1);
      if (candidate.getTime() > from.getTime()) return candidate;
    }
  }
  return null;
}

async function runForUser(userId: string): Promise<void> {
  const startedAt = Date.now();
  console.log(`[scheduler] running scheduled discovery for user ${userId} at ${new Date().toISOString()}`);
  try {
    const result = await runScheduledDiscovery(userId);
    console.log(`[scheduler] user ${userId}: ${result.message} (${Date.now() - startedAt}ms)`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[scheduler] user ${userId} run failed: ${msg}`);
  }
}

function scheduleUser(userId: string, interval: string, hour: number, day: number): void {
  const jobs = state().jobs;
  const existing = jobs.get(userId);
  const expression = buildCronExpression(interval, hour, day);

  if (existing) {
    existing.stop();
    existing.destroy();
    jobs.delete(userId);
  }

  const task = cron.schedule(expression, () => runForUser(userId), {
    name: `discovery-${userId}`,
    noOverlap: true,
  });

  jobs.set(userId, task);
  const when = computeNextRun(interval, hour, day);
  console.log(`[scheduler] user ${userId} scheduled: "${expression}" (${interval}${interval === 'daily' ? ` @ ${hour}:00` : ` day ${day} @ ${hour}:00`}) next run ${when?.toISOString()}`);
}

// Reconciles cron tasks with the DB: (re)create jobs for users with
// scheduleEnabled=true, drop jobs for everyone else. Safe to call repeatedly.
export async function resyncScheduler(): Promise<void> {
  const enabled = await prisma.settings.findMany({
    where: { scheduleEnabled: true },
    select: { userId: true, scheduleInterval: true, scheduleHour: true, scheduleDay: true },
  });

  const wanted = new Set(enabled.map(s => s.userId));
  const jobs = state().jobs;

  for (const userId of Array.from(jobs.keys())) {
    if (!wanted.has(userId)) {
      const task = jobs.get(userId)!;
      task.stop();
      task.destroy();
      jobs.delete(userId);
      console.log(`[scheduler] user ${userId} unscheduled`);
    }
  }

  for (const s of enabled) {
    scheduleUser(s.userId, s.scheduleInterval || 'daily', s.scheduleHour ?? 8, s.scheduleDay ?? 1);
  }

  console.log(`[scheduler] resync complete: ${jobs.size} scheduled user(s)`);
}

// Idempotent boot — instrumentation calls this once per process.
export function startScheduler(): void {
  const s = state();
  if (s.started) return;
  s.started = true;

  // Don't block the server from becoming ready on a slow first resync.
  resyncScheduler()
    .then(() => console.log('[scheduler] boot complete'))
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] boot failed: ${msg}`);
    });
}

export function stopScheduler(): void {
  const s = state();
  for (const task of s.jobs.values()) {
    task.stop();
    task.destroy();
  }
  s.jobs.clear();
  s.started = false;
}
