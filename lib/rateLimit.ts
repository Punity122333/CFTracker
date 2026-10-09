// Client-side rate limiter for the Codeforces API (~1 request per 2 seconds).
// Instances are not shared on Vercel, so this runs in the browser.

const MIN_GAP_MS = 2000;
let lastRun = 0;
let queue: Promise<unknown> = Promise.resolve();

function now(): number {
  return Date.now();
}

export function cfQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run: Promise<T> = queue.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (now() - lastRun));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastRun = now();
    }
  });
  // Keep the chain alive even if one call rejects.
  queue = run.catch(() => undefined);
  return run;
}

export function _resetForTests(): void {
  lastRun = 0;
  queue = Promise.resolve();
}

export const CF_MIN_GAP_MS = MIN_GAP_MS;
