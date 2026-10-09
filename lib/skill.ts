// Per-topic skill model. All functions are pure (no I/O, no Dexie):
// pages build evidence from local data and call these, so everything is testable.
//
// Model: P(solve | theta, d) = 1 / (1 + 10^((d - theta) / ELO_SCALE)).
// Topics (ids from data/topics.json) carry their own theta; the global
// theta is only an anchor/prior. A problem with several topics is judged
// by softmin over its topics, i.e. mostly by the weakest one.

import {
  COLD_START_RATING,
  CONTEST_ONLY_CAP,
  CONTEST_ONLY_DISCOUNT,
  ELO_SCALE,
  ESTIMATE_WINDOWS_DAYS,
  FEEDBACK_MAX_DRIFT,
  HELP_WEIGHT,
  IN_CONTEST_FAIL_WEIGHT,
  IN_CONTEST_SOLVE_BONUS,
  IN_CONTEST_WINDOW_HOURS,
  MAX_BELOW,
  MAX_STRETCH,
  MIN_SOLVES_ESTIMATE,
  RAMP_DOWN_STREAK,
  RAMP_STEP,
  RAMP_UP_STREAK,
  RATING_MAX,
  RATING_MIN,
  RECENCY_HALFLIFE_DAYS,
  SHRINKAGE_K,
  SOFTMIN_TEMP,
  SOLVE_MARGIN,
  SOLVE_PERCENTILE,
  SOLVE_WEIGHT_ASSISTED,
  SOLVE_WEIGHT_EDITORIAL,
  SOLVE_WEIGHT_HINT2,
  SOLVE_WEIGHT_TAG_HINT,
  TARGET_OFFSET,
  TARGET_WINDOW_HI,
  TARGET_WINDOW_LO,
  TOPIC_ABOVE_CAP,
  TOPIC_BELOW_CAP,
  UNTOUCHED_PENALTY,
  UPSOLVE_HALFLIFE_DAYS,
  UPSOLVE_WEIGHT,
} from "./tuning";
import type { TopicDef } from "./topics";

export function eloSolveProb(theta: number, difficulty: number): number {
  return 1 / (1 + Math.pow(10, (difficulty - theta) / ELO_SCALE));
}

// Exponential recency weight in [0,1]; half-life from tuning.
export function recencyWeight(timestamp: number, nowMs: number, halfLifeDays = RECENCY_HALFLIFE_DAYS): number {
  const ageDays = Math.max(0, (nowMs - timestamp) / 86400000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// ---- AtCoder difficulty -> Codeforces scale ----
// kenkoooo "difficulty" is roughly an AtCoder performance value (ABC A
// tasks sit near 100-300, ABC F near 800-1200, ARC/AGC hard tasks 1600+).
// Mapping is piecewise-linear through these anchors, monotone increasing,
// clamped at both ends. Never compare raw AtCoder difficulty to CF rating.
const ATCODER_ANCHORS: [number, number][] = [
  [0, 800],
  [400, 800],
  [800, 1100],
  [1200, 1500],
  [1600, 1900],
  [2000, 2400],
  [2400, 2700],
];

export function atcoderToCF(diff: number): number {
  if (diff <= ATCODER_ANCHORS[0][0]) return ATCODER_ANCHORS[0][1];
  for (let i = 1; i < ATCODER_ANCHORS.length; i++) {
    const [x0, y0] = ATCODER_ANCHORS[i - 1];
    const [x1, y1] = ATCODER_ANCHORS[i];
    if (diff <= x1) {
      const t = (diff - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  const last = ATCODER_ANCHORS[ATCODER_ANCHORS.length - 1];
  return Math.min(3000, last[1] + Math.round((diff - last[0]) * 0.75));
}

// ---- global anchor ----

export type GlobalSource =
  | "comfort"
  | "min-rating-solves"
  | "contest-only"
  | "solves-only"
  | "cold-start";

export interface GlobalEstimate {
  theta: number;
  source: GlobalSource;
  contestRating?: number;
  solveEstimate?: number;
  estimateWindow?: string; // which progressive window produced the solve estimate
  estimateCount?: number; // rated solves inside that window
}

export interface RatedSolve {
  difficulty: number;
  timestamp: number;
  quality?: number; // solve-quality weight (default 1.0)
}

export interface ProgressiveEstimate {
  value: number;
  windowDays: number | null; // null = all time
  windowLabel: string; // "120d" | "365d" | "all time"
  n: number; // rated solves inside the chosen window
}

// Progressive window: try 120d, then 365d, then all time. First window
// with at least MIN_SOLVES_ESTIMATE rated solves wins. Recency weighting
// applies within the chosen window. Never returns null when given solves.
export function progressiveEstimate(solves: RatedSolve[], nowMs: number): ProgressiveEstimate | null {
  const rated = solves.filter((s) => s.difficulty != null);
  if (rated.length === 0) return null;
  const windows: { days: number | null; label: string }[] = [
    ...ESTIMATE_WINDOWS_DAYS.map((days) => ({ days: days as number | null, label: `${days}d` })),
    { days: null, label: "all time" },
  ];
  for (const w of windows) {
    const days: number | null = w.days;
    const inWindow =
      days == null
        ? rated
        : rated.filter((s) => nowMs - s.timestamp <= days * 86400000);
    if (inWindow.length < MIN_SOLVES_ESTIMATE) continue;
    const weighted = inWindow
      .map((s) => ({ d: s.difficulty, w: recencyWeight(s.timestamp, nowMs) * (s.quality ?? 1) }))
      .sort((a, b) => a.d - b.d);
    const total = weighted.reduce((acc, x) => acc + x.w, 0);
    let acc = 0;
    for (const x of weighted) {
      acc += x.w;
      if (acc / total >= SOLVE_PERCENTILE / 100) {
        return {
          value: clamp(Math.round(x.d) - SOLVE_MARGIN, RATING_MIN, RATING_MAX),
          windowDays: w.days, windowLabel: w.label, n: inWindow.length,
        };
      }
    }
    const last = weighted[weighted.length - 1];
    return {
      value: clamp(Math.round(last.d) - SOLVE_MARGIN, RATING_MIN, RATING_MAX),
      windowDays: w.days, windowLabel: w.label, n: inWindow.length,
    };
  }
  return null;
}

// Back-compat alias: single number or null (prefer progressiveEstimate).
export function solveBasedEstimate(solves: RatedSolve[], nowMs: number): number | null {
  return progressiveEstimate(solves, nowMs)?.value ?? null;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function estimateGlobal(input: {
  comfortRating?: number;
  contestRating?: number;
  unaidedSolves: RatedSolve[];
  nowMs: number;
}): GlobalEstimate {
  const { comfortRating, contestRating, unaidedSolves, nowMs } = input;
  if (typeof comfortRating === "number" && Number.isFinite(comfortRating) && comfortRating > 0) {
    return { theta: clamp(Math.round(comfortRating), RATING_MIN, RATING_MAX), source: "comfort", contestRating };
  }
  const est = progressiveEstimate(unaidedSolves, nowMs);
  const hasRating = contestRating != null && contestRating > 0;
  if (est && hasRating) {
    // Never the higher of the two: contest rating overstates practical ability.
    return {
      theta: Math.min(contestRating as number, est.value),
      source: "min-rating-solves", contestRating,
      solveEstimate: est.value, estimateWindow: est.windowLabel, estimateCount: est.n,
    };
  }
  if (hasRating) {
    const r = contestRating as number;
    // A lone contest rating is a real signal: use it as-is under the cap,
    // discounted by CONTEST_ONLY_DISCOUNT above it instead of a hard cap.
    const theta = clamp(r <= CONTEST_ONLY_CAP ? r : r - CONTEST_ONLY_DISCOUNT, RATING_MIN, RATING_MAX);
    return { theta, source: "contest-only", contestRating };
  }
  if (est) {
    return {
      theta: est.value, source: "solves-only", contestRating,
      solveEstimate: est.value, estimateWindow: est.windowLabel, estimateCount: est.n,
    };
  }
  return { theta: COLD_START_RATING, source: "cold-start", contestRating };
}

// ---- problem -> topics ----

export interface TopicProblem {
  platform: "codeforces" | "cses" | "atcoder";
  tags: string[];
  csesTopicIds?: string[];
  manualTags?: string[];
}

// Map one problem to topic ids: CF tags through codeforcesTags,
// CSES per-problem ids, manual tags (topic ids). A problem may map to many.
export function topicsForProblem(p: TopicProblem, topics: TopicDef[]): string[] {
  const manual = (p.manualTags ?? []).map((t) => t.toLowerCase());
  const out = new Set<string>();
  for (const t of topics) {
    const id = t.id.toLowerCase();
    if (manual.includes(id)) {
      out.add(t.id);
      continue;
    }
    if (p.platform === "atcoder") continue; // no auto tags
    if (p.platform === "cses") {
      if ((p.csesTopicIds ?? []).includes(t.id)) out.add(t.id);
      continue;
    }
    const cfTags = new Set(t.codeforcesTags.map((x) => x.toLowerCase()));
    if (p.tags.some((x) => cfTags.has(x.toLowerCase()))) out.add(t.id);
  }
  return [...out];
}

// ---- per-topic ability ----

export interface AttemptEvidence {
  difficulty: number; // CF-normalized scale
  solved: boolean; // accepted solve (or todo marked solved) vs failure
  aided: boolean; // hints used / "solved without help" off
  stuck: boolean; // marked stuck: counts as a failure signal
  timestamp: number;
  key?: string; // problem key; repeated failures on one problem collapse to one
  weight?: number; // extra multiplier: solve quality, contest bonus, feedback
}

export interface TopicAbility {
  theta: number;
  confidence: number; // 0..1 from recency-weighted evidence count
  solves: number;
  failures: number;
  attempts: number; // distinct problems with evidence
  nEff: number; // recency-weighted evidence count
  prior: number;
  overridden: boolean;
}

// Prior chain: prerequisites with evidence -> group peers -> global.
// Untouched topics sit UNTOUCHED_PENALTY below their fallback, never above global.
export function topicPrior(
  topic: TopicDef,
  topics: TopicDef[],
  thetaByTopic: Map<string, number>
): number {
  const withEvidence = (ids: string[]): number[] =>
    ids.map((id) => thetaByTopic.get(id)).filter((v): v is number => typeof v === "number");
  const prereqThetas = withEvidence(topic.prerequisites);
  if (prereqThetas.length > 0) {
    return Math.round(prereqThetas.reduce((a, b) => a + b, 0) / prereqThetas.length);
  }
  const peers = topics.filter((t) => t.group === topic.group && t.id !== topic.id);
  const peerThetas = withEvidence(peers.map((t) => t.id));
  if (peerThetas.length > 0) {
    return Math.round(peerThetas.reduce((a, b) => a + b, 0) / peerThetas.length);
  }
  return Number.NaN; // caller falls back to global
}

// Elo-style update over evidence, oldest first, from the prior.
// Solves pull theta up toward difficulty + margin; failures pull down.
export function estimateTopicAbility(
  globalTheta: number,
  prior: number,
  evidence: AttemptEvidence[],
  nowMs: number,
  override?: number
): TopicAbility {
  // Untouched topics (no prior from the chain) start UNTOUCHED_PENALTY
  // below global, and shrink toward that penalized prior with evidence.
  const base = Number.isFinite(prior) ? prior : globalTheta - UNTOUCHED_PENALTY;
  const start = base;
  let theta = start;
  let nEff = 0;
  let solves = 0;
  let failures = 0;
  // One failure per problem counts: keep only the latest failure signal per key.
  const latestFailure = new Map<string, AttemptEvidence>();
  const solveItems: AttemptEvidence[] = [];
  const ordered = [...evidence].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of ordered) {
    if (!e.stuck && e.solved) {
      solveItems.push(e);
    } else if (e.key) {
      const prev = latestFailure.get(e.key);
      if (!prev || e.timestamp >= prev.timestamp) latestFailure.set(e.key, e);
    } else {
      solveItems.push(e); // keyless failures count individually (already collapsed by caller)
    }
  }
  const items = [...solveItems, ...latestFailure.values()].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of items) {
    const w = recencyWeight(e.timestamp, nowMs) * (e.aided ? HELP_WEIGHT : 1) * (e.weight ?? 1);
    if (w <= 0) continue;
    const failed = e.stuck || !e.solved;
    nEff += w;
    if (!failed) {
      solves += 1;
      // move theta toward difficulty: full credit at/below current level
      theta += w * 0.25 * (e.difficulty + 50 - theta);
    } else {
      failures += 1;
      theta += w * 0.25 * (e.difficulty - 250 - theta);
    }
  }
  const attempts = items.length; // post-collapse distinct signals
  const shrunk = (nEff * theta + SHRINKAGE_K * base) / (nEff + SHRINKAGE_K);
  const bounded = clamp(
    Math.round(shrunk),
    globalTheta - TOPIC_BELOW_CAP,
    globalTheta + TOPIC_ABOVE_CAP
  );
  const confidence = nEff / (nEff + SHRINKAGE_K);
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return {
      theta: clamp(Math.round(override), globalTheta - TOPIC_BELOW_CAP, globalTheta + TOPIC_ABOVE_CAP),
      confidence,
      solves,
      failures,
      attempts,
      nEff,
      prior: base,
      overridden: true,
    };
  }
  return { theta: bounded, confidence, solves, failures, attempts, nEff, prior: base, overridden: false };
}

// Softmin over a problem's topic thetas: judged mostly by the weakest topic.
export function softminTheta(thetas: number[], temp = SOFTMIN_TEMP): number {
  if (thetas.length === 0) throw new Error("softmin needs at least one theta");
  if (thetas.length === 1) return thetas[0];
  const lo = Math.min(...thetas);
  // shift for numerical stability
  const exps = thetas.map((t) => Math.exp(-(t - lo) / temp));
  const sum = exps.reduce((a, b) => a + b, 0);
  const weighted = thetas.reduce((acc, t, i) => acc + t * exps[i], 0) / sum;
  return weighted;
}

// Effective ability for one problem: softmin over its topics, else global.
export function problemTheta(topicIds: string[], thetaByTopic: Map<string, number>, globalTheta: number): number {
  const thetas = topicIds
    .map((id) => thetaByTopic.get(id))
    .filter((v): v is number => typeof v === "number");
  if (thetas.length === 0) return globalTheta;
  return Math.round(softminTheta(thetas));
}

// Adaptive ramp: signed streak per topic. N consecutive unaided solves
// near target raise the offset by RAMP_STEP (capped at MAX_STRETCH);
// M consecutive failures/stuck lower it (floored at 0).
export function nextRamp(
  offset: number,
  streak: number,
  success: boolean
): { offset: number; streak: number } {
  const s = success ? (streak >= 0 ? streak + 1 : 1) : streak <= 0 ? streak - 1 : -1;
  let o = offset;
  let out = s;
  if (s >= RAMP_UP_STREAK) {
    o = Math.min(MAX_STRETCH, o + RAMP_STEP);
    out = 0;
  } else if (s <= -RAMP_DOWN_STREAK) {
    o = Math.max(0, o - RAMP_STEP);
    out = 0;
  }
  return { offset: o, streak: out };
}

// ---- solve quality ----

export type SolveQualityLevel = "unaided" | "tag hint" | "hint 2" | "editorial" | "assisted";

export interface SolveQuality {
  level: SolveQualityLevel;
  weight: number;
}

// Quality of one todo solve, from explicit evidence only. Synced accepted
// submissions with no todo data are unaided (weight 1.0); only the user's
// own data lowers the weight. A default-off "without help" flag with a
// written logic note counts as partial (0.7); without logic it is assisted.
export function solveQuality(input: {
  hintLevelUsed: number;
  solvedWithoutHelp: boolean;
  logicWritten: boolean;
  acceptedCodePresent: boolean;
  hasSubmission: boolean;
  override?: string;
}): SolveQuality {
  const levels: Record<string, SolveQuality> = {
    unaided: { level: "unaided", weight: 1 },
    "tag hint": { level: "tag hint", weight: SOLVE_WEIGHT_TAG_HINT },
    "hint 2": { level: "hint 2", weight: SOLVE_WEIGHT_HINT2 },
    editorial: { level: "editorial", weight: SOLVE_WEIGHT_EDITORIAL },
    assisted: { level: "assisted", weight: SOLVE_WEIGHT_ASSISTED },
  };
  if (input.override && levels[input.override]) return levels[input.override];
  const { hintLevelUsed, solvedWithoutHelp, logicWritten, acceptedCodePresent, hasSubmission } = input;
  if (hintLevelUsed >= 3) return { level: "editorial", weight: SOLVE_WEIGHT_EDITORIAL };
  if (hintLevelUsed === 2) return { level: "hint 2", weight: SOLVE_WEIGHT_HINT2 };
  if (hintLevelUsed === 1) return { level: "tag hint", weight: SOLVE_WEIGHT_TAG_HINT };
  if (acceptedCodePresent && !hasSubmission) {
    return { level: "assisted", weight: SOLVE_WEIGHT_ASSISTED };
  }
  if (!solvedWithoutHelp && !logicWritten) {
    return { level: "assisted", weight: SOLVE_WEIGHT_ASSISTED };
  }
  if (!solvedWithoutHelp) return { level: "hint 2", weight: SOLVE_WEIGHT_HINT2 };
  return { level: "unaided", weight: 1 };
}

// ---- feedback offset nudge ----

// Move a topic's target offset by nudge, capped at the hard-filter limit
// and at FEEDBACK_MAX_DRIFT accumulated movement per ISO week.
export function nudgeOffset(
  offset: number,
  weekKey: string | undefined,
  weekDrift: number,
  curWeekKey: string,
  nudge: number
): { offset: number; weekKey: string; drift: number } {
  const sameWeek = weekKey === curWeekKey;
  const driftSoFar = sameWeek ? weekDrift : 0;
  const room = Math.max(0, FEEDBACK_MAX_DRIFT - driftSoFar);
  const applied = Math.max(-room, Math.min(room, nudge));
  const next = Math.max(0, Math.min(MAX_STRETCH, offset + applied));
  return { offset: next, weekKey: curWeekKey, drift: driftSoFar + Math.abs(next - offset) };
}

export function isoWeekKey(timestamp: number): string {
  const d = new Date(timestamp);
  d.setUTCHours(0, 0, 0, 0);
  // Monday-start ISO week key
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

// ---- in-contest evidence ----

export type ContestEvidenceKind = "in-contest-solve" | "in-contest-fail" | "upsolve" | "none";

export interface ContestEvidence {
  kind: ContestEvidenceKind;
  weight: number; // evidence multiplier for this problem
}

export interface ContestSubmission {
  problemKey: string;
  verdict: string;
  timestamp: number;
  contestId?: number;
}

// Classify CF submissions against contest end-time windows
// (contestId -> rating-update timestamp). One output per problem:
// in-contest solves get a small bonus, in-contest failures count full,
// later solves are partial upsolves decaying with days after the contest.
export function classifyContestSubmissions(
  subs: ContestSubmission[],
  windows: Record<string, number>
): Map<string, ContestEvidence> {
  const out = new Map<string, ContestEvidence>();
  const byProblem = new Map<string, ContestSubmission[]>();
  for (const s of subs) {
    if (s.contestId == null) continue;
    const arr = byProblem.get(s.problemKey) ?? [];
    arr.push(s);
    byProblem.set(s.problemKey, arr);
  }
  const windowMs = IN_CONTEST_WINDOW_HOURS * 3600000;
  for (const [key, list] of byProblem) {
    const cid = String(list[0].contestId);
    const end = windows[cid];
    if (end == null) continue;
    const inWindow = list.filter((s) => s.timestamp >= end - windowMs && s.timestamp <= end);
    if (inWindow.length === 0) continue; // never attempted in-contest: no evidence
    const solvedIn = inWindow.some((s) => s.verdict === "OK");
    if (solvedIn) {
      out.set(key, { kind: "in-contest-solve", weight: IN_CONTEST_SOLVE_BONUS });
      continue;
    }
    const laterOk = list.some((s) => s.verdict === "OK" && s.timestamp > end);
    if (laterOk) {
      const firstLater = Math.min(
        ...list.filter((s) => s.verdict === "OK" && s.timestamp > end).map((s) => s.timestamp)
      );
      const daysAfter = Math.max(0, (firstLater - end) / 86400000);
      const decay = Math.pow(0.5, daysAfter / UPSOLVE_HALFLIFE_DAYS);
      out.set(key, { kind: "upsolve", weight: UPSOLVE_WEIGHT * decay });
    } else {
      out.set(key, { kind: "in-contest-fail", weight: IN_CONTEST_FAIL_WEIGHT });
    }
  }
  return out;
}

// Display target window for a theta + offset: [theta+offset-50, theta+offset+100].
export function targetWindow(theta: number, offset = TARGET_OFFSET): [number, number] {
  return [Math.round(theta + offset - TARGET_WINDOW_LO), Math.round(theta + offset + TARGET_WINDOW_HI)];
}

export function absoluteCeiling(globalTheta: number): number {
  return globalTheta + TOPIC_ABOVE_CAP + MAX_STRETCH;
}

export function hardFloor(thetaProblem: number): number {
  return thetaProblem - MAX_BELOW;
}

export function hardCeiling(thetaProblem: number): number {
  return thetaProblem + MAX_STRETCH;
}
