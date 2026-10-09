// The ONLY way any code obtains recommended problems.
// Hard filters can never be outscored, outvoted, or silently relaxed.

import {
  DAILY_TOP_K,
  DIVERSITY_SAME_CONTEST,
  DIVERSITY_SAME_TOPIC,
  FIT_SIGMA,
  MISTAKE_BIAS,
  RUNG_STEP,
  TARGET_OFFSET,
  WARMUP_BELOW,
  WARMUP_COUNT,
  W_ATTEMPTED,
  W_FIT,
  W_POPULARITY,
  W_READINESS,
  W_WEAK,
} from "./tuning";
import { absoluteCeiling, hardCeiling, hardFloor, problemTheta, targetWindow } from "./skill";

export interface Candidate {
  key: string;
  title: string;
  platform: string;
  difficulty?: number; // CF-normalized scale (AtCoder already converted)
  tags: string[];
  topicIds: string[];
  url: string;
  solved: boolean;
  attempted: boolean;
  inTodo: boolean;
  solvedCount?: number;
}

export interface TopicContext {
  theta: number; // per-topic ability
  solves: number;
  attempts: number;
  failures: number;
  offset: number; // adaptive ramp offset for this topic
}

export interface RankContext {
  globalTheta: number;
  topics: Map<string, TopicContext>; // topicId -> ability + ramp offset
  studyNext: Set<string>; // topic ids in the current study-next list
  defaultOffset?: number;
  targetShift?: number; // added to every target (warmup goes below level)
  mistakeTopics?: Set<string>; // topics tied to the dominant mistake category
  mistakeLabel?: string; // e.g. "overflow" — named in the reason line
}

export interface RankOptions {
  includeUnrated?: boolean;
  limit?: number;
  minSolvedCount?: number; // optional cf solvedCount sanity floor
  onlyTopics?: Set<string>; // restrict to these topics (practice sets)
  hiddenKeys?: Set<string>; // never-again filter: excluded everywhere
}

export interface RankedCandidate extends Candidate {
  score: number;
  reason: string;
  thetaProblem: number;
  mistakeBoost: boolean;
}

export interface FilterReport {
  kept: number;
  droppedSolved: number;
  droppedInTodo: number;
  droppedUnrated: number;
  droppedWindow: number;
  droppedSolvedCount: number;
  droppedHidden: number;
}

export function contestOf(key: string): string {
  const m = key.match(/^codeforces:(\d+)/);
  if (m) return `cf:${m[1]}`;
  const parts = key.split(":");
  return parts.length > 2 ? `${parts[0]}:${parts[1]}` : parts[0];
}

function topicThetaOf(id: string, ctx: RankContext): number {
  return ctx.topics.get(id)?.theta ?? ctx.globalTheta;
}

// Hard filters. Scoring never sees what this drops. Scarcity returns
// fewer candidates; callers show the "few problems left" line instead.
export function applyHardFilters(
  candidates: Candidate[],
  ctx: RankContext,
  options: RankOptions = {}
): { kept: Candidate[]; report: FilterReport } {
  const absCeil = absoluteCeiling(ctx.globalTheta);
  const kept: Candidate[] = [];
  const report: FilterReport = {
    kept: 0, droppedSolved: 0, droppedInTodo: 0,
    droppedUnrated: 0, droppedWindow: 0, droppedSolvedCount: 0,
    droppedHidden: 0,
  };
  for (const c of candidates) {
    if (c.solved) { report.droppedSolved++; continue; }
    if (c.inTodo) { report.droppedInTodo++; continue; }
    if (options.hiddenKeys?.has(c.key)) { report.droppedHidden++; continue; }
    if (c.difficulty == null) {
      if (!options.includeUnrated) { report.droppedUnrated++; continue; }
      kept.push(c);
      continue;
    }
    if (options.onlyTopics && !c.topicIds.some((t) => options.onlyTopics!.has(t))) {
      // topic-restricted practice set: silently skip off-topic here;
      // counted as window drops so scarcity messaging still works.
      report.droppedWindow++;
      continue;
    }
    if (c.difficulty > absCeil) { report.droppedWindow++; continue; }
    const thetaP = problemTheta(c.topicIds, new Map([...ctx.topics].map(([k, v]) => [k, v.theta])), ctx.globalTheta);
    if (c.difficulty > hardCeiling(thetaP) || c.difficulty < hardFloor(thetaP)) {
      report.droppedWindow++;
      continue;
    }
    if (options.minSolvedCount != null && (c.solvedCount ?? Infinity) < options.minSolvedCount) {
      report.droppedSolvedCount++;
      continue;
    }
    kept.push(c);
  }
  report.kept = kept.length;
  return { kept, report };
}

function primaryTopic(c: Candidate, ctx: RankContext): { id: string; theta: number } | null {
  let best: { id: string; theta: number } | null = null;
  for (const id of c.topicIds) {
    const t = topicThetaOf(id, ctx);
    if (!best || t < best.theta) best = { id, theta: t };
  }
  return best;
}

export function scoreCandidate(
  c: Candidate,
  ctx: RankContext,
  diversity: { topicCounts: Map<string, number>; contestCounts: Map<string, number> }
): { score: number; reason: string; thetaProblem: number; mistakeBoost: boolean } {
  const thetaMap = new Map([...ctx.topics].map(([k, v]) => [k, v.theta]));
  const thetaP = problemTheta(c.topicIds, thetaMap, ctx.globalTheta);
  const prim = primaryTopic(c, ctx);
  const tctx = prim ? ctx.topics.get(prim.id) : undefined;
  const offset = tctx?.offset ?? ctx.defaultOffset ?? TARGET_OFFSET;
  const target = thetaP + offset + (ctx.targetShift ?? 0);
  const d = c.difficulty ?? target;
  // 1. difficulty fit: gaussian around target, the dominant term
  const fit = Math.exp(-((d - target) * (d - target)) / (2 * FIT_SIGMA * FIT_SIGMA));
  // 2. weakness need: topic well below global, or failure-heavy
  let need = 0;
  if (tctx) {
    const gap = (ctx.globalTheta - tctx.theta) / 400;
    const failRate = tctx.attempts > 0 ? tctx.failures / tctx.attempts : 0;
    need = Math.max(0, gap) * 0.6 + failRate * 0.8;
    need = Math.min(need, 1.5);
  }
  // 3. attempted-but-never-solved (caller guarantees post-filter)
  const attemptedBonus = c.attempted ? 1 : 0;
  // 4. study-next readiness
  const readiness = c.topicIds.some((t) => ctx.studyNext.has(t)) ? 1 : 0;
  // 6. mild popularity prior at equal fit
  const popularity = c.solvedCount != null ? Math.min(1, Math.log10(1 + c.solvedCount) / 5) : 0;
  // 7. mistake bias: favor dominant-mistake topics, post-filter only
  const mistakeBoost = ctx.mistakeTopics != null && c.topicIds.some((t) => ctx.mistakeTopics!.has(t));
  let score =
    W_FIT * fit +
    W_WEAK * need +
    W_ATTEMPTED * attemptedBonus +
    W_READINESS * readiness +
    W_POPULARITY * popularity +
    (mistakeBoost ? MISTAKE_BIAS : 0);
  // 5. diversity: greedy penalty for repeats already picked
  for (const t of c.topicIds) {
    score -= DIVERSITY_SAME_TOPIC * (diversity.topicCounts.get(t) ?? 0);
  }
  score -= DIVERSITY_SAME_CONTEST * (diversity.contestCounts.get(contestOf(c.key)) ?? 0);

  const [wlo, whi] = targetWindow(thetaP, offset + (ctx.targetShift ?? 0));
  const solves = tctx?.solves ?? 0;
  const attempts = tctx?.attempts ?? 0;
  const label = prim ? prim.id : "mixed";
  const tstr = prim ? `ability ~${prim.theta}` : `level ~${thetaP}`;
  const reason =
    `${label} ${tstr}, you solved ${solves}/${attempts}, target ${wlo}-${whi}` +
    (mistakeBoost && ctx.mistakeLabel ? `, ${ctx.mistakeLabel} is your top mistake` : "");
  return { score, reason, thetaProblem: thetaP, mistakeBoost };
}

export function rankCandidates(
  ctx: RankContext,
  candidates: Candidate[],
  options: RankOptions = {}
): { ranked: RankedCandidate[]; report: FilterReport } {
  const { kept, report } = applyHardFilters(candidates, ctx, options);
  const diversity = { topicCounts: new Map<string, number>(), contestCounts: new Map<string, number>() };
  const ranked: RankedCandidate[] = [];
  // Greedy: score, pick best, apply diversity, repeat. Stable order by key
  // as a final tiebreak so output is deterministic.
  const pool = [...kept].sort((a, b) => (a.key < b.key ? -1 : 1));
  while (pool.length > 0) {
    let bestIdx = 0;
    let best = scoreCandidate(pool[0], ctx, diversity);
    for (let i = 1; i < pool.length; i++) {
      const s = scoreCandidate(pool[i], ctx, diversity);
      if (s.score > best.score) {
        best = s;
        bestIdx = i;
      }
    }
    const [c] = pool.splice(bestIdx, 1);
    for (const t of c.topicIds) {
      diversity.topicCounts.set(t, (diversity.topicCounts.get(t) ?? 0) + 1);
    }
    const cc = contestOf(c.key);
    diversity.contestCounts.set(cc, (diversity.contestCounts.get(cc) ?? 0) + 1);
    ranked.push({ ...c, score: best.score, reason: best.reason, thetaProblem: best.thetaProblem, mistakeBoost: best.mistakeBoost });
    if (options.limit != null && ranked.length >= options.limit) break;
  }
  return { ranked, report };
}

// Deterministic PRNG (mulberry32) from a string seed.
export function seededIndex(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Math.floor(rand() * n);
}

// Daily problem: top-K by score, seeded pick. Stable all day.
export function dailyPick(
  dateStr: string,
  handle: string,
  ranked: RankedCandidate[],
  topK = DAILY_TOP_K
): RankedCandidate | null {
  const pool = ranked.slice(0, Math.max(1, topK));
  if (pool.length === 0) return null;
  return pool[seededIndex(`${dateStr}|${handle}`, pool.length)];
}

// Random suggestion ("surprise me"): same filters, seeded pick from top-K.
export function surprisePick(
  seed: string,
  ranked: RankedCandidate[],
  topK = DAILY_TOP_K
): RankedCandidate | null {
  return dailyPick(seed, "surprise", ranked, topK);
}

export type RungMode = "climb" | "same" | "fast";

// Next rungs after a solve: same topic(s), stepped above the solved
// difficulty. Assisted/hard solves stay level or go lower; "easy"
// feedback climbs double. All rows pass the hard filters (ranked first).
export function nextRungs(
  ctx: RankContext,
  candidates: Candidate[],
  opts: { topicIds: string[]; solvedDifficulty: number; mode: RungMode; hiddenKeys?: Set<string> }
): { rungs: RankedCandidate[]; targets: [number, number]; note: string | null } {
  const step = opts.mode === "fast" ? 2 * RUNG_STEP : opts.mode === "same" ? 0 : RUNG_STEP;
  const targets: [number, number] =
    opts.mode === "same"
      ? [opts.solvedDifficulty, opts.solvedDifficulty - 50]
      : [opts.solvedDifficulty + step, opts.solvedDifficulty + 2 * step];
  const { ranked } = rankCandidates(
    ctx, candidates,
    { onlyTopics: new Set(opts.topicIds), limit: 40, hiddenKeys: opts.hiddenKeys }
  );
  const pick = (target: number): RankedCandidate | null => {
    let best: RankedCandidate | null = null;
    let bestGap = Infinity;
    for (const r of ranked) {
      if (r.difficulty == null) continue;
      const gap = Math.abs(r.difficulty - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = r;
      }
    }
    return best;
  };
  const rungs: RankedCandidate[] = [];
  for (const t of targets) {
    const r = pick(t);
    if (r && !rungs.some((x) => x.key === r.key)) rungs.push(r);
  }
  const note =
    opts.mode === "same" ? "assisted solve, same level first" : null;
  return { rungs, targets, note };
}

// Warmup picks: below-level targets, spread across distinct topics,
// all through the hard filters. Fewer when the pool is small.
export function warmupPicks(
  ctx: RankContext,
  candidates: Candidate[],
  count = WARMUP_COUNT,
  shift = WARMUP_BELOW
): RankedCandidate[] {
  const shifted: RankContext = { ...ctx, targetShift: (ctx.targetShift ?? 0) - shift };
  const { ranked } = rankCandidates(shifted, candidates, { limit: 40 });
  const picks: RankedCandidate[] = [];
  const usedTopics = new Set<string>();
  // first pass: distinct primary topics
  for (const r of ranked) {
    if (picks.length >= count) break;
    const prim = r.topicIds[0] ?? "mixed";
    if (usedTopics.has(prim)) continue;
    usedTopics.add(prim);
    picks.push(r);
  }
  // second pass: fill up regardless of topic
  for (const r of ranked) {
    if (picks.length >= count) break;
    if (!picks.some((x) => x.key === r.key)) picks.push(r);
  }
  return picks;
}
