# cftracker

Local-first competitive programming tracker for Codeforces, CSES and AtCoder. Single user, no auth, no AI, no third-party keys. All data in IndexedDB (Dexie); Next.js route handlers are thin proxies/caches only.

## Setup

```bash
npm install
npm run dev
```

## Run / test / lint

```bash
npm test        # vitest run
npm run lint    # next lint
npm run build   # next build (must pass before any phase is done)
npm run check-links  # manual link validation, never fails the build
```

## Vercel deploy

- Import repo, framework preset Next.js, no env vars needed.
- Default settings work: no custom server, no Docker, no filesystem writes.
- Route handlers are stateless; caching via `fetch next.revalidate` + Cache-Control.

## Platform notes

- Codeforces: public API via `/api/cf` proxy; client-side queue enforces ~1 request per 2s; proxy returns 429 + retry-after on throttle; sync skips already-stored submissions; stale cache shown with "last synced".
- AtCoder: kenkoooo AtCoder Problems API via `/api/atcoder`. It provides no topic tags, so AtCoder problems have no tags unless you add them manually (manual tags count exactly like platform tags).
- CSES: there is no official API. `data/cses.json` is the static problem list and manual marking is the primary, fully working path. `/api/cses-import` is a best-effort extra that tries the public user page and returns `{ok:false}` when flaky/blocked; if persistently broken, remove it and rely on manual.
- `data/cses.json` per-problem topic ids are hand-assigned and marked "needs user review" — verify against cses.fi.
- Problem statements are never scraped or stored: title, rating/difficulty, tags, outbound link only.

## Data

IndexedDB is per-browser/device. Cross-device use goes through settings export/import (versioned JSON covering all tables).

## How recommendations work

Ability is tracked per topic, not just globally. Each topic gets its own rating from your solves (full weight unaided, less with hints) and your failures (wrong answers, stuck marks), with recent attempts counting more. A problem needing several topics is judged by your weakest one. Recommendations stay near each topic's level and never above a hard ceiling; the /skill page (linked from settings) shows every number so you can sanity-check the model. Set "my comfortable level" in settings to override the estimate.

Rate recommendations easy / right / hard and the model adjusts that topic's target up or down (capped weekly); marking a problem too hard also hides it. Editorial-assisted solves count as partial evidence (unaided 1.0 down to assisted 0.25). In-contest solves count a little extra, upsolves count half. The /plan page builds a deterministic 7-day plan (weak topics, one new topic, due reviews, trainer sessions, one stretch, revisits, pre-contest warmup) through the same ranker and filters, and ticking Solved marks plan items done.
