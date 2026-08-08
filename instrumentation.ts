// Boot-time side effects. Runs once per Node server process before it starts
// accepting requests (see node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
// Used here to bring up the in-process Scheduled Refreshes cron.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
