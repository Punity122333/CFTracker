# AGENTS.md — cftracker

## Project summary

cftracker is a minimalistic, local-first, single-user web app for tracking competitive programming progress across Codeforces, CSES and AtCoder and for practicing problem understanding and deciding what to study next, with no auth, no AI/LLM features and no third-party keys, deploying to Vercel with zero extra infrastructure (Next.js App Router + Dexie/IndexedDB, thin route-handler proxies, JSON export/import).

## Stack and commands

- Next.js 14 (App Router) + TypeScript (strict) + Tailwind v3 (utility styling only)
- Dexie for IndexedDB, Vitest for unit tests, tsx for scripts
- install: `npm install`
- dev: `npm run dev`
- build: `npm run build` (also runs `next build`; fix all type and lint errors before declaring any phase done)
- test: `npm test` (vitest run)
- lint: `npm run lint` (next lint)
- check-links: `npm run check-links` (manual only; never fails the Vercel build)

## Folder structure and module ownership

- `app/` — pages (dashboard `/`, `/recommendations`, `/topics`, `/todo`, `/contests`, `/trainer`, `/notes`, `/settings`) + `app/api/cf|atcoder|cses-import/route.ts` thin proxies. `app/layout.tsx` owns nav + shell; `app/client-shell.tsx` owns Ctrl+K palette + vim keys + `?` overlay.
- `components/` — reserved for shared hairline-separated UI (currently pages are self-contained; do not add card components).
- `lib/db.ts` — Dexie schema + settings helpers (client-only).
- `lib/platforms/codeforces.ts|atcoder.ts|cses.ts` (+`types.ts`) — each exposes `fetchSolves` / `fetchProblems` returning the normalized Problem model; never scrape statements.
- `lib/recommend.ts` — `rankCandidates` + `applyHardFilters`, the ONLY source of recommended problems (daily, practice sets, surprise, trainer links).
- `lib/skill.ts` — per-topic ability model (global anchor, Elo updates, softmin, AtCoder conversion); pure, no I/O.
- `lib/tuning.ts` — every tunable as a named constant; nothing hardcoded elsewhere.
- `lib/skillContext.ts` — builds the skill snapshot from Dexie; records ramp/feedback outcomes; plan inputs; ability snapshots + backfill.
- `lib/trainer.ts` — Leitner box transitions + box-scaled difficulty.
- `lib/plan.ts` — pure weekly-plan builder (deterministic, capped, contest-aware).
- `lib/mistakes.ts` — mistake-pattern stats + checklist/topic data lookups.
- `lib/selection.ts` — selected-row store for keyboard + palette feedback actions.
- `app/skill/page.tsx` — debug view (global estimate, per-topic table, top-10).
- `lib/topics.ts` — status thresholds (named constants), prereq gating, study-next ranking, 3-way counting (CF tags, CSES per-problem ids, manual tags).
- `lib/srs.ts` — review dates at +3/+14/+30 days.
- `lib/parseProblemUrl.ts` — paste-a-URL parsing for all three platforms.
- `lib/rateLimit.ts` — client-side CF queue (≥2000ms gap).
- `lib/exportImport.ts` — versioned full export/import.
- `data/topics.json` — generated from the TOPIC LIST; `data/cses.json` — static CSES list with per-problem topic ids ("needs user review"); `data/algorithms.json` — ~20 trainer seeds.
- `scripts/check-links.ts` — manual link validation over generated resource URLs.

## Data model summary

Dexie tables: problems key (platform:id) + title/difficulty/tags/url/solvedCount?; submissions (platform, problemKey, verdict, language, timestamp, contestId?); todoItems (problemKey, solved, implemented, understood, solvedWithoutHelp, stuck, hintLevelUsed, logic markdown, acceptedCode, keyTrick, selfCheck{observation, complexity, edgeCases}, timerSeconds, addedAt, understoodAt?, qualityOverride?, done?, doneAt?, upsolve?); mistakes (problemKey, category, note, timestamp); reviews (problemKey, dueDates[3,14,30d], history[]); lists (id, name, problemKeys[]); manualTags (problemKey, tags[]); topicState (topicId, statusOverride?, skipped, note, userResources[], comfortRating?, targetOffset?, streak?, offsetWeek?, offsetWeekDrift?); trainerStats (algoId, mode, attempts, correct, box 1-5, dueAt, lastSeenAt, lastResult); feedback (problemKey, topicIds[], difficulty, easy|right|hard, source, time); hiddenProblems (problemKey, reason, time); plans (weekStart, items[]); warmups (startedAt, problemKeys[], solvedKeys[], durationSec); abilitySnapshots (date, globalTheta, topicThetas{}, source); snippets (id, title, tags, code); settings (handles, difficultyWindow offsets, weeklyGoal, stuckTimeoutMinutes, lastExportAt, comfortRating?, cfRating?, cfMaxRating?, showNextRungs?, warmupMinutes?, cfContestWindows?); syncMeta (platform, lastSyncAt, lastSubmissionId). Export/import covers all tables with a schema version field (`EXPORT_VERSION`, now 3; v1/v2 blobs migrate) and a migration path (reject newer versions with a clear error; future versions upgrade in `importAll`). `data/cses.json` entries now also carry a nominal `difficulty` estimate ("needs user review", same as topic ids).

## UI rules (do not violate)

The UI must look hand-built, not AI-generated. Specifically:
- No card grids, no rounded boxes with shadows, no little random bordered boxes around everything, no glassmorphism, no gradients, no glow effects.
- No emoji or icon-library icons in headings and buttons. Text labels only. At most a few small, consistent inline SVG glyphs where truly needed.
- No hero sections, no marketing copy, no "Welcome back" greetings.
- Layout: plain document-style pages. Left-aligned content, a narrow max-width column, generous whitespace, simple top nav with text links.
- Data shown as plain tables and lists separated by thin 1px hairlines, not as cards. The Topics page follows this too: a table with expandable rows, not a grid of topic tiles.
- One typeface family for text, a monospace for numbers/ids/code. Small number of font sizes.
- Two colors plus one accent: near-white background, near-black text, one muted accent for links and active state. Provide dark mode through prefers-color-scheme using the same restraint.
- Border radius at most 2-4px, and only on inputs and buttons.
- Charts: minimal, thin lines, no fills, no legend boxes, direct labels, no animation.
- Status labels (not started / learning / practicing / solid) are plain text, not colored pills or badges.
- Dense but readable.
- Copy tone: terse and lowercase-friendly labels, no exclamation marks, no filler text, no placeholder lorem.
- Drift guard: components tend to creep toward generic card-based styling as the codebase grows. Before finishing any UI work, check it against these rules and fix violations. If a component wraps content in a bordered/rounded/shadowed container, replace it with a hairline-separated section.

## UI amendment 2026-10-08 (user-directed, supersedes parts of the rules above)

The user found the strict minimalism too plain ("generic html") and asked for bolder design. The verbatim block above is kept for history; effective rules from now on:
- Allowed: bordered panels (1px hairline, radius up to 8px) for stats, spotlights and todo items; stat blocks with big mono numbers; CSS progress bars; weekday-aligned heatmap grid; pill nav with active state; brand mark + wordmark header; footer; success/warn functional colors alongside the accent.
- Still banned: gradients, glow, glassmorphism, shadows, emoji, icon libraries, hero sections, marketing copy.
- Tables stay for tabular data (now inside panels with header tint + row hover). Status labels stay plain text.

## Platform notes

- Codeforces: public API (user.info, user.status, user.rating, problemset.problems, contest.list). Limit ~1 request per 2 seconds ("Call limit exceeded" otherwise); enforced client-side via `lib/rateLimit.ts` queue, proxy returns 429 + retry-after on throttle. Sync incrementally (skip already-stored submissionIds). Cache TTLs: problemset 6h, contest list 30min, submissions/user.info 2min, rating 30min.
- AtCoder: kenkoooo AtCoder Problems API (user submissions, merged-problems, problem-models for difficulty). It provides no topic tags, so AtCoder problems have no tags unless the user adds them manually (manual tags count toward topic stats exactly like platform tags).
- CSES: there is no official API. `data/cses.json` is the static problem list; manual marking of solved status is the primary, fully working path. `/api/cses-import` is a best-effort extra that tries the public user page and returns `{ok:false}` cleanly when flaky/blocked; if persistently broken, remove it and rely on manual (README says so). `data/cses.json` per-problem topic ids are hand-assigned and marked "needs user review".
- Problem statements are never scraped or stored. Every problem is a title, rating/difficulty, tags, and an outbound link. Normalized model: platform, id, title, difficulty, tags, url.

## DEPLOYMENT

- Must build and run on Vercel's default Next.js settings. No custom server, no Docker, no filesystem writes at runtime.
- Route handlers are stateless serverless functions. Do not rely on in-memory state or module-level caches surviving between requests.
- Cache upstream API responses using fetch with `next: { revalidate }` and Cache-Control headers (s-maxage + stale-while-revalidate). Suggested TTLs: problemset 6h, contest list 30min, user submissions 2min.
- Because instances are not shared, enforce the Codeforces rate limit (~1 request per 2 seconds) client-side with a request queue, and have the proxy return a clear error with retry-after if upstream throttles.
- Static data (CSES list, algorithm seeds, topics list) is bundled as JSON imports, not read from disk at runtime.
- No environment variables required. The app works with zero configuration.
- Keep route handler responses small and set explicit `runtime` per handler (default nodejs; use edge only where clearly fine).
- IndexedDB is per-browser/device, so cross-device use goes through export/import. Say this plainly in the README and the settings page.
- README section for Vercel: import repo, framework preset Next.js, no env vars needed.
- Run `next build` and fix all type and lint errors before declaring any phase done. Check that no page depends on browser-only APIs during server rendering (use client components and dynamic imports where needed).

## Conventions

- TypeScript strict; no unused exports or dead code.
- No new dependencies without a stated reason (current: dexie, vitest + vite [vitest peer], tsx, fake-indexeddb for tests).- Small commits per feature.
- Re-read this file at the start of every phase and before writing any new UI component.
- After link check: ran `npm run check-links` on 2026-10-08 — 7 dead removed (usaco gold/topo-sort, gold/binary-jumping, silver/custom-cpp-stl, gold/point-update, gold/segtree, gold/range-update; cp-algorithms graph/centroid-decomposition.html). All remaining resource URLs return 2xx.

## Phase status

- [x] Phase 1: AGENTS.md, Dexie schema, Codeforces sync (queue + proxy), dashboard basics, todo (3 ticks, logic, self-check, timer, help flag, hint ladder). Deployable.
- [x] Phase 2: recommendations, Topics page (topics.json, status rules, study-next, practice sets, notes, manual tags), AtCoder + CSES (cses.json per-problem ids), URL paste, mistake log, stuck/revisit, daily problem.
- [x] Phase 3: SRS due-for-review, contests (upsolve, virtual, calendar), pseudocode trainer (3 modes + seeds).
- [x] Phase 4: notes search, snippet vault, weekly summary, command palette, vim keys + ? overlay, export/import + backup reminder, DESIGN audit.
- [x] Maintenance 2026-10-08: db v2 (indexed submissionId + contestId on submissions; fixes sync crash "KeyPath submissionId is not indexed", auto-upgrades from v1) + UI polish pass (wordmark header, active nav, type scale, table hover, refined buttons; still no cards/shadows/gradients/emoji per UI rules).
- [x] Maintenance 2026-10-08 (2): fixed unstyled-HTML incident (stale production `.next` artifacts made dev `_next/static` 404; cleared `.next`, dev CSS 200 again; do not run `next build` while the dev server is serving) + UI v2 redesign (stat blocks, spotlight daily, bars, heatmap grid, rating chart labels, todo panels, pill nav, brand header) per explicit user override, recorded above.
- [x] Maintenance 2026-10-08 (3): estimator fix — recommendations showed "using 800 as a guess" despite synced history. Causes: unaided filter excluded solves lacking the todo flag, 120d/10-solve floor dropped older histories, cfRating missing on old syncs. Fix: all accepted synced submissions count unaided by default, progressive 120d→365d→all-time window (min 5), rating-only uses rating (−200 above 1400 cap), sync stores cfRating+cfMaxRating, /skill has an "estimator inputs" table naming the exact drop step, recommendations line states the true source; cold-start line only with genuinely no data.
- [x] Phase 5: adaptive rating-aware recommendations/topics/trainer (per-topic ability, shared ranker, Leitner trainer, /skill debug page).
  Skill model: global anchor = comfortRating ?? min(contest rating, 70th-pct unaided solves −50, ≥5 solves over progressive 120d→365d→all-time windows) with contest-only rating (−200 above the 1400 cap) / cold-start 800, clamped [800,2800]; every accepted synced submission counts as unaided by default (only todo hint use downweights; pure self-reports stay cautious), one entry per problem at first-accepted time, missing difficulties skipped not zeroing; per-topic Elo (P=1/(1+10^((d−θ)/400))) with recency half-life 60d, help weight 0.4, one-failure-per-problem; prior = prereqs → group peers → global, untouched −100; shrinkage k=4; bounds ±500; multi-topic problems judged by softmin (T=200). Ranker (`rankCandidates` + `applyHardFilters`) is the only source of recommended problems: per-problem window θ±(200/300), absolute ceiling global+500+200, gaussian fit at θ+offset(100) dominant, weakness/attempted/readiness/popularity terms, greedy topic/contest diversity, per-topic ramp ±50 (3 up/2 down) on topicState, seeded daily/surprise. Trainer: trainerStats table (db v3, export v2), Leitner 1/3/7/14/30d, box-scaled blanks/lines/distractors. Constants: lib/tuning.ts. Debug: /skill (global table, per-topic table, top-10).
- [x] Phase 6: self-correcting heuristics and planning (feedback easy/right/hard, solve-quality weights, in-contest evidence, next-rung, mistake patterns, weekly plan, warmup, ability history). Ranker stays the only source; hard filters never bypassed.  Feedback: `feedback` table (problemKey, topicIds, difficulty, easy|right|hard, source, time); easy adds solve evidence (0.5, softmin-weighted to weakest) + offset +25, hard adds partial failure (0.5) + offset −25, right adds confidence-only evidence (0.2); weekly drift cap 50 via topicState offsetWeek/offsetWeekDrift; /skill shows e/r/h counts. Solve quality: unaided 1.0, tag hint 0.9, hint 2 0.7, editorial 0.4, assisted 0.25; synced accepts default unaided; editable override per todo. In-contest: contest windows persisted in settings (contestId→end), in-contest solves ×1.25, failures ×1.0, upsolves ×0.5 decaying (30d half-life); /skill contest table. Never-again: `hiddenProblems` table, hard filter in applyHardFilters, tooHard also records hard feedback, settings unhide list. Next-rung: same-topic ladder (+75/+150; assisted/hard stay level, easy climbs double) under solved todos (settings toggle). Mistakes: 60d window, dominant at ≥35% share + ≥5, checklist + topic bias (0.5, post-filter only) with reason line. Plan: `plans` table, /plan page, weak/study-next/review/trainer/stretch/revisit/warmup composition scaled by weekly goal, caps per day + rest day + light contest days, deterministic seed, done preserved + todo-sync. Warmup: `warmups` table, 3 below-level distinct-topic picks, countdown, result log.   History: `abilitySnapshots` table (daily idempotent + 26-week backfill in batches), dashboard global line, /skill 6-topic picker + 4-week delta table. DB v4, export v3 (v1/v2 migrate). Keys e/r/h/d on selected rows + palette commands + ? overlay. Constants: lib/tuning.ts.
- [x] Maintenance: button press feedback (CSS :active press + transition, busy/disabled sync buttons, reduced-motion guard), todo done section (`done`/`doneAt` flags, move/restore) + upsolve section (`upsolve` flag, due-reviews-first via `upsolveFirst` in lib/srs.ts, feeds contests upsolve list), full-width layout (removed 860px caps on page/header/footer).