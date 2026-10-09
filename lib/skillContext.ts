// Builds the full Phase 5 skill snapshot from local Dexie + static data.
// Client-side (uses db()). The math stays pure in skill.ts; this module
// only gathers evidence. Shared by recommendations, topics, /skill,
// dashboard daily, and the trainer.
import { db, getSettings } from "./db";
import type {
  FeedbackRow,
  ManualTagRow,
  MistakeRow,
  ProblemRow,
  SettingsRow,
  SubmissionRow,
  SyncMetaRow,
  TodoItem,
  TopicStateRow,
} from "./db";
import topicsData from "../data/topics.json";
import { csesTopicIds } from "./platforms/cses";
import {
  atcoderToCF,
  classifyContestSubmissions,
  estimateGlobal,
  estimateTopicAbility,
  isoWeekKey,
  nextRamp,
  nudgeOffset,
  solveQuality,
  topicsForProblem,
  topicPrior,
  type AttemptEvidence,
  type GlobalEstimate,
  type TopicAbility,
} from "./skill";
import {
  deriveStatus,
  effectiveStatus,
  problemsForTopic,
  rankStudyNext,
  topicStats,
  type TopicDef,
} from "./topics";
import {
  FEEDBACK_FAIL_WEIGHT,
  FEEDBACK_NUDGE,
  FEEDBACK_RIGHT_WEIGHT,
  FEEDBACK_WEIGHT,
  MIN_SOLVES_ESTIMATE,
  SOFTMIN_TEMP,
  TARGET_OFFSET,
} from "./tuning";
import { mistakeStats, topicsForMistake } from "./mistakes";
import type { Candidate, RankContext } from "./recommend";
import type { FeedbackRating, FeedbackSource } from "./db";

// Shared ranker context from a snapshot (single construction site so every
// caller gets offsets, study-next, mistake bias and target shifts alike).
export function rankContextFromSnapshot(
  snap: SkillSnapshot,
  opts: { targetShift?: number; mistakeTopics?: Set<string>; mistakeLabel?: string } = {}
): RankContext {
  const topics = new Map(
    [...snap.thetaByTopic].map(([id, theta]) => {
      const s = snap.perTopic.get(id);
      return [id, {
        theta,
        solves: s?.ability.solves ?? 0,
        attempts: s?.ability.attempts ?? 0,
        failures: s?.ability.failures ?? 0,
        offset: s?.offset ?? TARGET_OFFSET,
      }];
    })
  );
  return {
    globalTheta: snap.global.theta, topics, studyNext: snap.studyNextIds,
    targetShift: opts.targetShift,
    mistakeTopics: opts.mistakeTopics ?? new Set(snap.mistake.topics),
    mistakeLabel: opts.mistakeLabel ?? snap.mistake.label ?? undefined,
  };
}

// One plain line telling the truth about where the level comes from.
export function levelLine(snap: SkillSnapshot): string {
  const g = snap.global;
  if (g.source === "comfort") return `level ~${g.theta} set by you in settings.`;
  if (g.source === "min-rating-solves" || g.source === "solves-only") {
    return `level ~${g.theta} estimated from ${g.estimateCount ?? 0} solved problems (${g.estimateWindow ?? "all time"}); set your own in settings to override.`;
  }
  if (g.source === "contest-only") {
    return `level ~${g.theta} from contest rating ${g.contestRating}; set your own in settings to override.`;
  }
  if (!snap.estimator.handleSet) return "no handle set yet — add it in settings, then sync.";
  return "no synced solves yet, sync your handle.";
}

// Every unsolved problem as a ranker candidate, with topic mapping and
// CF-normalized difficulty. The ranker's hard filters do the rest.
export async function buildCandidates(): Promise<Candidate[]> {
  const d = db();
  const [probs, subs, todos] = await Promise.all([
    d.problems.toArray(),
    d.submissions.toArray(),
    d.todoItems.toArray(),
  ]);
  const manualRows = await d.manualTags.toArray();
  const manualByKey = new Map(manualRows.map((r) => [r.problemKey, r.tags]));
  const csesMap = csesTopicIds();
  const topics = allTopics();
  const solved = new Set(subs.filter((s) => s.verdict === "OK").map((s) => s.problemKey));
  const attempted = new Set(subs.map((s) => s.problemKey));
  const inTodo = new Set(todos.map((t) => t.problemKey));
  for (const t of todos) {
    if (t.solved) solved.add(t.problemKey);
    attempted.add(t.problemKey);
  }
  return probs.map((p) => {
    const diff = p.difficulty == null
      ? undefined
      : p.platform === "atcoder" && p.difficulty < 3000
        ? atcoderToCF(p.difficulty)
        : p.difficulty;
    return {
      key: p.key,
      title: p.title,
      platform: p.platform,
      difficulty: diff,
      tags: p.tags ?? [],
      topicIds: topicsForProblem(
        {
          platform: p.platform,
          tags: p.tags ?? [],
          csesTopicIds: csesMap.get(p.key),
          manualTags: manualByKey.get(p.key),
        },
        topics
      ),
      url: p.url,
      solved: solved.has(p.key),
      attempted: attempted.has(p.key),
      inTodo: inTodo.has(p.key),
      solvedCount: p.solvedCount,
    };
  });
};

export type TopicMap = TopicDef[];

export function allTopics(): TopicDef[] {
  return (topicsData as unknown as { topics: TopicMap }).topics;
}

export interface TopicSnapshot {
  ability: TopicAbility;
  status: string;
  derived: string;
  solved: number;
  attempted: number;
  weightedSolved: number;
  target: [number, number];
  offset: number;
  feedback: { easy: number; right: number; hard: number };
}

export interface ContestEvidenceSummary {
  contests: number;
  inContestSolves: number;
  inContestFailures: number;
  upsolves: number;
  topics: { id: string; count: number }[];
}

export interface EstimatorInputs {
  handleSet: boolean;
  cfHandle: string;
  lastSyncAt: number | null;
  submissionsTotal: number;
  acceptedTotal: number;
  acceptedProblems: number; // distinct problems, first accepted each
  withDifficulty: number; // of those, joined to a difficulty
  inWindow: number; // inside the chosen progressive window
  windowLabel: string;
  minSolves: number;
  contestRating: number | null;
  branch: string; // which fallback branch produced theta
  guess: number; // final theta
}

export interface SkillSnapshot {
  topics: TopicDef[];
  global: GlobalEstimate;
  thetaByTopic: Map<string, number>;
  perTopic: Map<string, TopicSnapshot>;
  studyNextIds: Set<string>;
  coldStart: boolean;
  usingGuess: boolean; // comfortRating empty: recommendations shows the guess line
  estimator: EstimatorInputs;
  contestEvidence: ContestEvidenceSummary;
  mistake: { topics: string[]; label: string | null; counts: Record<string, number> };
}

interface ProblemState {
  key: string;
  platform: "codeforces" | "cses" | "atcoder";
  difficulty?: number;
  tags: string[];
  topicIds: string[];
  solved: boolean;
  attempted: boolean;
  aided: boolean;
  stuck: boolean;
  timestamp: number;
  firstOk: number; // first accepted submission, 0 if none
  quality: number; // solve-quality weight for solves
}

export interface ModelData {
  subs: SubmissionRow[];
  todos: TodoItem[];
  probs: ProblemRow[];
  manualRows: ManualTagRow[];
  stateRows: TopicStateRow[];
  feedbackRows: FeedbackRow[];
  mistakeRows: MistakeRow[];
  settings: SettingsRow;
  syncRows: SyncMetaRow[];
}

async function loadModelData(): Promise<ModelData> {
  const d = db();
  const settings = await getSettings();
  const [subs, todos, probs, manualRows, stateRows, feedbackRows, mistakeRows, syncRows] = await Promise.all([
    d.submissions.toArray(),
    d.todoItems.toArray(),
    d.problems.toArray(),
    d.manualTags.toArray(),
    d.topicState.toArray(),
    d.feedback.toArray(),
    d.mistakes.toArray(),
    d.syncMeta.toArray(),
  ]);
  return { subs, todos, probs, manualRows, stateRows, feedbackRows, mistakeRows, settings, syncRows };
}

export async function buildSkillSnapshot(): Promise<SkillSnapshot> {
  return computeSnapshot(await loadModelData(), Date.now());
}

// Full snapshot computation as a pure-ish function of loaded data at a
// cutoff time. Backfill reuses it with historical cutoffs (evidence after
// the cutoff is invisible, recency is relative to the cutoff).
function computeSnapshot(data: ModelData, now: number): SkillSnapshot {
  const topics = allTopics();
  const { settings, probs, manualRows, stateRows, mistakeRows, syncRows } = data;
  const subs = data.subs.filter((s) => s.timestamp <= now);
  const todos = data.todos.filter((t) => t.addedAt <= now);
  const feedbackRows = data.feedbackRows.filter((f) => f.timestamp <= now);

  const manualByKey = new Map(manualRows.map((r) => [r.problemKey, r.tags]));
  const csesMap = csesTopicIds();
  const todoByKey = new Map(todos.map((t) => [t.problemKey, t]));
  const subsByKey = new Map<string, typeof subs>();
  for (const s of subs) {
    const arr = subsByKey.get(s.problemKey) ?? [];
    arr.push(s);
    subsByKey.set(s.problemKey, arr);
  }

  // Normalize difficulties: AtCoder raw values convert to the CF scale.
  const normDiff = (platform: string, raw: number | undefined): number | undefined => {
    if (raw == null) return undefined;
    if (platform === "atcoder" && raw < 3000) return atcoderToCF(raw);
    return raw;
  };

  // Per-problem state from submissions + todo.
  // Aided rule: every accepted submission counts as unaided by default.
  // Only downweight when the user's own todo says hints were used. A
  // pure todo tick (no accepted submission) counts as unaided only when
  // "solved without help" is explicitly on — a default-off flag is not
  // evidence either way, so self-reports stay cautious.
  const states: ProblemState[] = probs.map((p) => {
    const ss = subsByKey.get(p.key) ?? [];
    const oks = ss.filter((s) => s.verdict === "OK");
    const ok = oks.length > 0;
    const firstOk = ok ? Math.min(...oks.map((s) => s.timestamp)) : 0;
    const todo = todoByKey.get(p.key);
    const solved = ok || !!todo?.solved;
    const attempted = ss.length > 0 || !!todo;
    const q = solveQuality({
      hintLevelUsed: todo?.hintLevelUsed ?? 0,
      solvedWithoutHelp: todo ? todo.solvedWithoutHelp : true,
      logicWritten: (todo?.logic?.trim().length ?? 0) > 0,
      acceptedCodePresent: (todo?.acceptedCode?.trim().length ?? 0) > 0,
      hasSubmission: ok,
      override: todo?.qualityOverride,
    });
    const stuck = !!todo?.stuck;
    const ts = Math.max(firstOk, todo?.addedAt ?? 0, ss[ss.length - 1]?.timestamp ?? 0);
    const topicIds = topicsForProblem(
      {
        platform: p.platform,
        tags: p.tags ?? [],
        csesTopicIds: csesMap.get(p.key),
        manualTags: manualByKey.get(p.key),
      },
      topics
    );
    return {
      key: p.key, platform: p.platform,
      difficulty: normDiff(p.platform, p.difficulty),
      tags: p.tags ?? [], topicIds, solved, attempted,
      aided: q.weight < 1, stuck,
      timestamp: ts || now, firstOk, quality: q.weight,
    };
  });

  // Global anchor: one entry per solved problem (first accepted), weighted
  // by solve quality. Missing difficulties are skipped, never zeroing.
  const rated = states.filter((s) => s.solved && s.difficulty != null);
  const unaided = rated.map((s) => ({
    difficulty: s.difficulty as number,
    timestamp: s.firstOk > 0 ? s.firstOk : s.timestamp,
    quality: s.quality,
  }));
  const global = estimateGlobal({
    comfortRating: settings.comfortRating,
    contestRating: settings.cfRating,
    unaidedSolves: unaided,
    nowMs: now,
  });

  const lastSyncAt = syncRows.length > 0 ? Math.max(...syncRows.map((r) => r.lastSyncAt)) : null;
  const acceptedKeys = new Set(
    subs.filter((s) => s.verdict === "OK").map((s) => s.problemKey)
  );
  const probDiff = new Map(probs.map((p) => [p.key, normDiff(p.platform, p.difficulty)]));
  const withDiff = [...acceptedKeys].filter((k) => probDiff.get(k) != null).length;
  const estimator: EstimatorInputs = {
    handleSet: settings.cfHandle !== "" || settings.atcoderHandle !== "",
    cfHandle: settings.cfHandle || settings.atcoderHandle,
    lastSyncAt,
    submissionsTotal: subs.length,
    acceptedTotal: subs.filter((s) => s.verdict === "OK").length,
    acceptedProblems: acceptedKeys.size,
    withDifficulty: withDiff,
    inWindow: global.estimateCount ?? 0,
    windowLabel: global.estimateWindow ?? "—",
    minSolves: MIN_SOLVES_ESTIMATE,
    contestRating: settings.cfRating ?? null,
    branch: global.source,
    guess: global.theta,
  };

  // Evidence index per topic. Solve evidence carries the solve-quality
  // weight; in-contest solves get a small bonus, upsolves count partial.
  const contestMap = classifyContestSubmissions(
    subs.map((s) => ({
      problemKey: s.problemKey, verdict: s.verdict,
      timestamp: s.timestamp, contestId: s.contestId,
    })),
    settings.cfContestWindows ?? {}
  );
  const evidence = new Map<string, AttemptEvidence[]>();
  const addEv = (id: string, e: AttemptEvidence) => {
    const arr = evidence.get(id) ?? [];
    arr.push(e);
    evidence.set(id, arr);
  };
  for (const s of states) {
    if (s.difficulty == null) continue;
    if (!s.solved && !s.attempted) continue;
    const contestW = contestMap.get(s.key)?.weight ?? 1;
    for (const id of s.topicIds) {
      addEv(id, {
        difficulty: s.difficulty, solved: s.solved, aided: false,
        stuck: s.stuck, timestamp: s.timestamp, key: s.key,
        weight: (s.solved ? s.quality : 1) * contestW,
      });
    }
  }

  const stateByTopic = new Map(stateRows.map((r) => [r.topicId, r]));
  // First pass thetas (for prior chain): compute in dependency order via
  // fixed-point iteration (3 passes suffice for chains like dp->treedp).
  const thetaByTopic = new Map<string, number>();
  const abilityByTopic = new Map<string, TopicAbility>();
  const estimateAll = () => {
    // 3 passes: prior chains (e.g. dpbasics -> treedp) resolve regardless
    // of topic order in the file.
    for (let pass = 0; pass < 3; pass++) {
      for (const t of topics) {
        const prior = topicPrior(t, topics, thetaByTopic);
        const st = stateByTopic.get(t.id);
        const ab = estimateTopicAbility(
          global.theta, prior, evidence.get(t.id) ?? [], now, st?.comfortRating
        );
        thetaByTopic.set(t.id, ab.theta);
        abilityByTopic.set(t.id, ab);
      }
    }
  };
  estimateAll();
  // Phase 2: feedback evidence, shares weighted toward the weakest topic
  // (softmin shares from phase-1 thetas). Easy adds solve evidence, hard
  // adds partial failure evidence, right adds confidence-only evidence.
  for (const f of feedbackRows) {
    if (f.difficulty == null || f.topicIds.length === 0) continue;
    const thetas = f.topicIds.map((id) => thetaByTopic.get(id) ?? global.theta);
    const lo = Math.min(...thetas);
    const exps = thetas.map((t) => Math.exp(-(t - lo) / SOFTMIN_TEMP));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    f.topicIds.forEach((id, i) => {
      const share = exps[i] / sum;
      const base =
        f.rating === "easy"
          ? { solved: true, weight: FEEDBACK_WEIGHT * share }
          : f.rating === "hard"
            ? { solved: false, weight: FEEDBACK_FAIL_WEIGHT * share }
            : { solved: true, weight: FEEDBACK_RIGHT_WEIGHT * share };
      addEv(id, {
        difficulty: f.difficulty as number, solved: base.solved, aided: false,
        stuck: false, timestamp: f.timestamp, key: `feedback:${f.id}`, weight: base.weight,
      });
    });
  }
  estimateAll();

  const feedbackCounts = new Map<string, { easy: number; right: number; hard: number }>();
  for (const f of feedbackRows) {
    for (const id of f.topicIds) {
      const c = feedbackCounts.get(id) ?? { easy: 0, right: 0, hard: 0 };
      c[f.rating]++;
      feedbackCounts.set(id, c);
    }
  }

  // Statuses (weighted) + study-next.
  const perTopic = new Map<string, TopicSnapshot>();
  const statusById = new Map<string, string>();
  const solvedById = new Map<string, number>();
  const weightedById = new Map<string, number>();
  for (const t of topics) {
    const refs = states
      .filter((s) => s.topicIds.includes(t.id))
      .map((s) => ({
        key: s.key, platform: s.platform, tags: s.tags,
        topicIds: csesMap.get(s.key), solved: s.solved,
        attempted: s.attempted, difficulty: s.difficulty,
        quality: s.solved ? s.quality : 1,
      }));
    // Reuse the canonical 3-way counting for status solved/attempted sets.
    const matched = problemsForTopic(t, refs, manualByKey);
    const st = topicStats(matched, t.ratingRange[0]);
    const derived = deriveStatus(st);
    const ov = stateByTopic.get(t.id);
    const eff = effectiveStatus(derived, ov?.statusOverride, ov?.skipped);
    const theta = thetaByTopic.get(t.id) ?? global.theta;
    const offset = ov?.targetOffset ?? TARGET_OFFSET;
    const ab = abilityByTopic.get(t.id)!;
    statusById.set(t.id, eff);
    solvedById.set(t.id, st.solved);
    weightedById.set(t.id, st.weightedSolved);
    perTopic.set(t.id, {
      ability: ab, status: eff, derived,
      solved: st.solved, attempted: matched.filter((p) => p.attempted || p.solved).length,
      weightedSolved: st.weightedSolved,
      target: [Math.round(theta + offset - 50), Math.round(theta + offset + 100)],
      offset,
      feedback: feedbackCounts.get(t.id) ?? { easy: 0, right: 0, hard: 0 },
    });
  }
  const studyNext = new Set(
    rankStudyNext({
      topics, statusById, solvedById, weightedById,
      thetaByTopic, globalTheta: global.theta,
    }).map((c) => c.topic.id)
  );

  // Contest evidence summary for the /skill table.
  const contestKinds = new Map<string, number>();
  const topicContestHits = new Map<string, number>();
  for (const [key, ev] of contestMap) {
    if (ev.kind === "in-contest-solve") contestKinds.set("solves", (contestKinds.get("solves") ?? 0) + 1);
    else if (ev.kind === "in-contest-fail") contestKinds.set("fails", (contestKinds.get("fails") ?? 0) + 1);
    else if (ev.kind === "upsolve") contestKinds.set("upsolves", (contestKinds.get("upsolves") ?? 0) + 1);
    const st = states.find((s) => s.key === key);
    for (const id of st?.topicIds ?? []) {
      topicContestHits.set(id, (topicContestHits.get(id) ?? 0) + 1);
    }
  }
  const contestWindows = settings.cfContestWindows ?? {};
  const contestedIds = new Set(
    subs.filter((s) => s.contestId != null && contestWindows[String(s.contestId)] != null)
      .map((s) => String(s.contestId))
  );
  const contestEvidence: ContestEvidenceSummary = {
    contests: contestedIds.size,
    inContestSolves: contestKinds.get("solves") ?? 0,
    inContestFailures: contestKinds.get("fails") ?? 0,
    upsolves: contestKinds.get("upsolves") ?? 0,
    topics: [...topicContestHits]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count })),
  };

  return {
    topics, global, thetaByTopic, perTopic, studyNextIds: studyNext,
    coldStart: global.source === "cold-start",
    usingGuess: (settings.comfortRating ?? 0) <= 0,
    estimator,
    contestEvidence,
    mistake: (() => {
      const ms = mistakeStats(
        mistakeRows.map((m) => ({ category: m.category, timestamp: m.timestamp })),
        now
      );
      return {
        topics: ms.dominant ? topicsForMistake(ms.dominant) : [],
        label: ms.dominant,
        counts: ms.counts,
      };
    })(),
  };
}

// Record a ramp outcome for every topic a problem maps to.
export async function recordTopicOutcome(
  problemKey: string,
  success: boolean
): Promise<void> {
  const topics = allTopics();
  const d = db();
  const [probs, manualRows] = await Promise.all([
    d.problems.toArray(),
    d.manualTags.toArray(),
  ]);
  const p = probs.find((x) => x.key === problemKey);
  if (!p) return;
  const manualByKey = new Map(manualRows.map((r) => [r.problemKey, r.tags]));
  const ids = topicsForProblem(
    {
      platform: p.platform, tags: p.tags ?? [],
      csesTopicIds: csesTopicIds().get(p.key),
      manualTags: manualByKey.get(p.key),
    },
    topics
  );
  for (const id of ids) {
    const prev = await d.topicState.where("topicId").equals(id).first();
    const cur = { offset: prev?.targetOffset ?? TARGET_OFFSET, streak: prev?.streak ?? 0 };
    const next = nextRamp(cur.offset, cur.streak, success);
    if (prev?.id) {
      await d.topicState.update(prev.id, { targetOffset: next.offset, streak: next.streak });
    } else {
      await d.topicState.add({
        topicId: id, skipped: false, note: "", userResources: [],
        targetOffset: next.offset, streak: next.streak,
      });
    }
  }
}

// All hidden problem keys (never-again filter input for every ranker call).
export async function loadHiddenKeys(): Promise<Set<string>> {
  const rows = await db().hiddenProblems.toArray();
  return new Set(rows.map((r) => r.problemKey));
}

// Snapshot ability at most once per day (idempotent: same day overwrites
// nothing, just skips). Called on sync and on opening /skill.
export async function maybeSnapshot(snap?: SkillSnapshot): Promise<void> {
  const d = db();
  const today = new Date().toISOString().slice(0, 10);
  const prev = await d.abilitySnapshots.where("date").equals(today).first();
  if (prev) return;
  const s = snap ?? (await buildSkillSnapshot());
  await d.abilitySnapshots.add({
    date: today,
    globalTheta: s.global.theta,
    topicThetas: Object.fromEntries(s.thetaByTopic),
    source: "auto",
  });
}

// Backfill (best effort): recompute the model at weekly cutoffs for the
// past 26 weeks. Approximate (current comfort overrides apply throughout),
// weekly points only, in small async batches so the UI never blocks.
export async function backfillAbility(
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const data = await loadModelData();
  if (data.subs.length === 0) return 0;
  const now = Date.now();
  const cutoffs: number[] = [];
  for (let w = 26; w >= 1; w--) cutoffs.push(now - w * 7 * 86400000);
  const d = db();
  let stored = 0;
  for (let i = 0; i < cutoffs.length; i++) {
    const snap = computeSnapshot(data, cutoffs[i]);
    const date = new Date(cutoffs[i]).toISOString().slice(0, 10);
    const prev = await d.abilitySnapshots.where("date").equals(date).first();
    const row = {
      date,
      globalTheta: snap.global.theta,
      topicThetas: Object.fromEntries(snap.thetaByTopic),
      source: "auto" as const,
    };
    if (prev?.id) await d.abilitySnapshots.update(prev.id, row);
    else await d.abilitySnapshots.add(row);
    stored++;
    if (i % 4 === 3) {
      onProgress?.(i + 1, cutoffs.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(cutoffs.length, cutoffs.length);
  return stored;
}

export interface SnapshotPoint {
  date: string;
  globalTheta: number;
  topicThetas: Record<string, number>;
}

// Weekly delta per topic: now vs ~4 weeks ago (nearest snapshot at least
// 28 days old, else the oldest one).
export function weeklyDeltas(
  points: SnapshotPoint[],
  current: Map<string, number>
): { id: string; now: number; delta: number }[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  const cutoff = new Date(new Date(`${latest.date}T00:00:00Z`).getTime() - 28 * 86400000)
    .toISOString()
    .slice(0, 10);
  const base = [...sorted].reverse().find((p) => p.date <= cutoff) ?? sorted[0];
  const ids = new Set([...Object.keys(base.topicThetas), ...current.keys()]);
  return [...ids].map((id) => ({
    id,
    now: current.get(id) ?? base.topicThetas[id] ?? 0,
    delta: (current.get(id) ?? 0) - (base.topicThetas[id] ?? 0),
  }));
}

// Map a problem key to its topics (shared by feedback + ramp recording).
async function topicsOfProblem(problemKey: string): Promise<{ topicIds: string[]; difficulty?: number }> {
  const topics = allTopics();
  const d = db();
  const [probs, manualRows] = await Promise.all([
    d.problems.toArray(),
    d.manualTags.toArray(),
  ]);
  const p = probs.find((x) => x.key === problemKey);
  if (!p) return { topicIds: [] };
  const manualByKey = new Map(manualRows.map((r) => [r.problemKey, r.tags]));
  return {
    topicIds: topicsForProblem(
      {
        platform: p.platform, tags: p.tags ?? [],
        csesTopicIds: csesTopicIds().get(p.key),
        manualTags: manualByKey.get(p.key),
      },
      topics
    ),
    difficulty: p.difficulty,
  };
}

// Record easy/right/hard feedback: an evidence row plus an offset nudge.
// Easy nudges the weakest topic's target up (half for the rest), hard
// nudges down; right moves nothing. Nudges respect the weekly drift cap.
export async function recordFeedback(input: {
  problemKey: string;
  rating: FeedbackRating;
  source: FeedbackSource;
  difficulty?: number;
  topicIds?: string[];
}): Promise<void> {
  const d = db();
  const now = Date.now();
  let topicIds = input.topicIds;
  let difficulty = input.difficulty;
  if (!topicIds) {
    const mapped = await topicsOfProblem(input.problemKey);
    topicIds = mapped.topicIds;
    difficulty ??= mapped.difficulty;
  }
  await d.feedback.add({
    problemKey: input.problemKey, topicIds, difficulty,
    rating: input.rating, source: input.source, timestamp: now,
  });
  if (input.rating === "right" || topicIds.length === 0) return;
  const snap = await buildSkillSnapshot();
  const thetas = topicIds.map((id) => snap.thetaByTopic.get(id) ?? snap.global.theta);
  const weakest = topicIds[thetas.indexOf(Math.min(...thetas))];
  const base = input.rating === "easy" ? FEEDBACK_NUDGE : -FEEDBACK_NUDGE;
  for (const id of topicIds) {
    const nudge = id === weakest ? base : Math.round(base / 2);
    const prev = await d.topicState.where("topicId").equals(id).first();
    const r = nudgeOffset(
      prev?.targetOffset ?? TARGET_OFFSET,
      prev?.offsetWeek, prev?.offsetWeekDrift ?? 0,
      isoWeekKey(now), nudge
    );
    if (prev?.id) {
      await d.topicState.update(prev.id, {
        targetOffset: r.offset, offsetWeek: r.weekKey, offsetWeekDrift: r.drift,
      });
    } else {
      await d.topicState.add({
        topicId: id, skipped: false, note: "", userResources: [],
        targetOffset: r.offset, offsetWeek: r.weekKey, offsetWeekDrift: r.drift,
      });
    }
  }
}
