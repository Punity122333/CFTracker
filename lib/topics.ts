// Topic status rules + study-next ranking + per-topic counting.
// Thresholds are named constants (do not hardcode elsewhere).
// Phase 5: solve counting is difficulty-aware (weighted solves drive
// status); study-next eligibility and sorting use per-topic ability.

import {
  MAX_STRETCH,
  PRACTICE_THRESHOLD_DEFAULT,
  STUDY_NEXT_MARGIN,
  TOPIC_EASY_WEIGHT,
  TOPIC_FLOOR_MARGIN,
} from "./tuning";

export const STATUS_NOT_STARTED = "not started";
export const STATUS_LEARNING = "learning";
export const STATUS_PRACTICING = "practicing";
export const STATUS_SOLID = "solid";

export const THRESHOLD_PRACTICING_SOLVED = 3;
export const THRESHOLD_SOLID_SOLVED = 8;
export const THRESHOLD_SOLID_RATE = 0.6;
// Re-exported from tuning so all tunables live in one place.
export { PRACTICE_THRESHOLD_DEFAULT };

export interface TopicDef {
  id: string;
  name: string;
  group: string;
  prerequisites: string[];
  codeforcesTags: string[];
  ratingRange: [number, number];
  description: string;
  resources: { label: string; url: string }[];
}

export interface TopicStats {
  solved: number;
  attempted: number;
  solveRate: number;
  medianDifficulty?: number;
  weightedSolved: number; // difficulty-aware solve credit
}

export type TopicStatus = string;

export function deriveStatus(stats: TopicStats): TopicStatus {
  const solved = stats.weightedSolved ?? stats.solved;
  if (solved <= 0 && stats.attempted <= 0) return STATUS_NOT_STARTED;
  if (solved >= THRESHOLD_SOLID_SOLVED && stats.solveRate >= THRESHOLD_SOLID_RATE)
    return STATUS_SOLID;
  if (solved >= THRESHOLD_PRACTICING_SOLVED) return STATUS_PRACTICING;
  return STATUS_LEARNING;
}

export function effectiveStatus(
  derived: TopicStatus,
  override?: string,
  skipped?: boolean
): TopicStatus {
  if (skipped) return "skipped";
  if (override && override.length > 0) return override;
  return derived;
}

export interface ProblemRef {
  key: string;
  platform: "codeforces" | "cses" | "atcoder";
  tags: string[];
  topicIds?: string[];
  solved: boolean;
  attempted: boolean;
  difficulty?: number;
  quality?: number; // solve-quality weight (default 1.0)
}

// Counting: (1) CF tags via codeforcesTags, (2) CSES per-problem topicIds,
// (3) manual tags. AtCoder without manual tags never counts.
export function problemsForTopic(
  topic: TopicDef,
  problems: ProblemRef[],
  manualTagsByKey: Map<string, string[]>
): ProblemRef[] {
  const cfTags = new Set(topic.codeforcesTags.map((t) => t.toLowerCase()));
  return problems.filter((p) => {
    const manual = (manualTagsByKey.get(p.key) ?? []).map((t) => t.toLowerCase());
    // manual tag match: topic id or name words
    if (manual.includes(topic.id.toLowerCase())) return true;
    if (p.platform === "atcoder") return false; // no auto tags
    if (p.platform === "cses") {
      return (p.topicIds ?? []).includes(topic.id);
    }
    // codeforces
    const all = [...p.tags.map((t) => t.toLowerCase()), ...manual];
    return all.some((t) => cfTags.has(t));
  });
}

// A solve counts fully only when difficulty >= rangeLo - TOPIC_FLOOR_MARGIN;
// easier solves count at TOPIC_EASY_WEIGHT. Trivial 800s must not make a
// 1000+ topic "solid".
export function solveWeight(difficulty: number | undefined, rangeLo: number): number {
  if (difficulty == null) return TOPIC_EASY_WEIGHT;
  return difficulty >= rangeLo - TOPIC_FLOOR_MARGIN ? 1 : TOPIC_EASY_WEIGHT;
}

export function topicStats(matched: ProblemRef[], rangeLo?: number): TopicStats {
  const attempted = matched.filter((p) => p.attempted || p.solved).length;
  const solved = matched.filter((p) => p.solved).length;
  const solveRate = attempted > 0 ? solved / attempted : 0;
  const weightedSolved =
    rangeLo == null
      ? solved
      : matched
          .filter((p) => p.solved)
          .reduce((acc, p) => acc + solveWeight(p.difficulty, rangeLo) * (p.quality ?? 1), 0);
  const diffs = matched
    .filter((p) => p.solved && typeof p.difficulty === "number")
    .map((p) => p.difficulty as number)
    .sort((a, b) => a - b);
  let medianDifficulty: number | undefined;
  if (diffs.length > 0) medianDifficulty = diffs[Math.floor(diffs.length / 2)];
  return { solved, attempted, solveRate, medianDifficulty, weightedSolved };
}

export interface StudyCandidate {
  topic: TopicDef;
  status: TopicStatus;
  solved: number;
  weightedSolved: number;
  ability?: number;
  abilityGap?: number;
  reason: string;
  prereqsReady: boolean;
}

export interface StudyNextInput {
  topics: TopicDef[];
  statusById: Map<string, TopicStatus>;
  solvedById: Map<string, number>;
  weightedById: Map<string, number>;
  thetaByTopic: Map<string, number>;
  globalTheta: number;
  practiceThreshold?: number;
}

// Study-next: prerequisites practicing|solid, typical range lower bound
// within reach of the global level. Sorted by readiness, then ability gap
// (weakest first), then lowest weighted solves. Overrides/skip win (the
// page filters skipped before calling; learned overrides count as ready).
export function rankStudyNext(input: StudyNextInput): StudyCandidate[] {
  const {
    topics,
    statusById,
    solvedById,
    weightedById,
    thetaByTopic,
    globalTheta,
    practiceThreshold = PRACTICE_THRESHOLD_DEFAULT,
  } = input;
  const out: StudyCandidate[] = [];
  for (const t of topics) {
    const st = statusById.get(t.id) ?? STATUS_NOT_STARTED;
    if (st === "skipped") continue;
    const solved = solvedById.get(t.id) ?? 0;
    if (solved >= practiceThreshold) continue;
    // Typical range is used only for eligibility, never for picking problems.
    const [lo] = t.ratingRange;
    if (lo > globalTheta + MAX_STRETCH + STUDY_NEXT_MARGIN) continue;
    const prereqs = t.prerequisites;
    const ready = prereqs.every((p) => {
      const s = statusById.get(p);
      return s === STATUS_PRACTICING || s === STATUS_SOLID || s === "learned";
    });
    if (!ready) continue;
    const theta = thetaByTopic.get(t.id);
    const gap = theta != null ? globalTheta - theta : 0;
    out.push({
      topic: t,
      status: st,
      solved,
      weightedSolved: weightedById.get(t.id) ?? 0,
      ability: theta,
      abilityGap: gap,
      prereqsReady: ready,
      reason: whyLine(t, solved, theta, globalTheta, statusById),
    });
  }
  out.sort(
    (a, b) =>
      (b.abilityGap ?? 0) - (a.abilityGap ?? 0) || a.weightedSolved - b.weightedSolved
  );
  return out.slice(0, 5);
}

function whyLine(
  t: TopicDef,
  solved: number,
  theta: number | undefined,
  globalTheta: number,
  statusById: Map<string, TopicStatus>
): string {
  const ability = theta != null ? `ability ~${theta} vs your ~${globalTheta}` : `~${solved} solved`;
  if (t.prerequisites.length > 0) {
    const names = t.prerequisites
      .map((p) => `${p} is ${statusById.get(p) ?? STATUS_NOT_STARTED}`)
      .join(", ");
    return `${ability}, ${solved} solved, ${names}`;
  }
  return `${ability}, ${solved} solved`;
}
