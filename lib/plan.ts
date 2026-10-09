// Weekly plan generator. Pure function over local data (testable);
// the page loads inputs from Dexie + snapshot and persists the result.
// Every problem pick goes through the shared ranker (hard filters,
// hidden problems, feedback offsets, mistake bias all apply).
import {
  PLAN_MAX_PER_DAY,
  PLAN_MAX_REVIEWS_PER_DAY,
  PLAN_NEW_TOPIC_COUNT,
  PLAN_REST_DAY,
  PLAN_REVISIT_COUNT,
  PLAN_STRETCH_COUNT,
  PLAN_TRAINER_SESSIONS,
  PLAN_WEAK_COUNT,
} from "./tuning";
import { rankCandidates, seededIndex, type Candidate, type RankContext } from "./recommend";
import type { PlanItem, PlanItemKind } from "./db";

export interface PlanInput {
  weekStart: string; // ISO date (Monday)
  handle: string;
  ctx: RankContext;
  candidates: Candidate[];
  hiddenKeys: Set<string>;
  weakTopics: string[]; // topic ids, largest ability gap below global first
  studyNextTopic: string | null;
  studyNextTitle: string;
  reviewsDueKeys: string[];
  stuckKeys: string[];
  trainerDue: { algoId: string; title: string }[];
  strongTopics: string[]; // highest theta with attempts first
  contestDays: number[]; // 0-6 day indexes with a contest that week
  weeklyGoal: number;
  doneRefs: Set<string>; // refs already done (regenerate keeps them done)
  titles: Map<string, { title: string; url: string }>;
}

interface Draft {
  kind: PlanItemKind;
  ref: string;
  title: string;
  reason: string;
  fixedDay?: number;
}

function titleOf(titles: Map<string, { title: string; url: string }>, key: string): string {
  return titles.get(key)?.title ?? key;
}

export function buildPlanItems(input: PlanInput): PlanItem[] {
  const scale = Math.max(0.5, input.weeklyGoal / 5);
  const drafts: Draft[] = [];
  const seed = (part: string) => `${input.weekStart}|${input.handle}|${part}`;

  // weak topics at their own target levels (seeded pick from top-5 each)
  const weakCount = Math.max(1, Math.round(PLAN_WEAK_COUNT * scale));
  let added = 0;
  for (const t of input.weakTopics) {
    if (added >= weakCount) break;
    const { ranked } = rankCandidates(input.ctx, input.candidates, {
      onlyTopics: new Set([t]), limit: 8, hiddenKeys: input.hiddenKeys,
    });
    if (ranked.length === 0) continue;
    const pick = ranked[seededIndex(seed(`weak|${t}`), Math.min(5, ranked.length))];
    drafts.push({ kind: "weak", ref: pick.key, title: pick.title, reason: pick.reason });
    added++;
  }

  // one new study-next topic: read day + practice problems
  if (input.studyNextTopic) {
    drafts.push({
      kind: "new-topic-read", ref: input.studyNextTopic,
      title: `read ${input.studyNextTitle} resources`, reason: "new study-next topic",
    });
    const { ranked } = rankCandidates(input.ctx, input.candidates, {
      onlyTopics: new Set([input.studyNextTopic]), limit: 6, hiddenKeys: input.hiddenKeys,
    });
    for (const r of ranked.slice(0, PLAN_NEW_TOPIC_COUNT)) {
      drafts.push({ kind: "new-topic-practice", ref: r.key, title: r.title, reason: r.reason });
    }
  }

  // spaced-repetition reviews (spread + capped in distribution)
  for (const key of input.reviewsDueKeys) {
    if (input.hiddenKeys.has(key)) continue;
    drafts.push({ kind: "review", ref: key, title: titleOf(input.titles, key), reason: "spaced review due" });
  }

  // trainer sessions of due algorithms
  for (const t of input.trainerDue.slice(0, PLAN_TRAINER_SESSIONS)) {
    drafts.push({ kind: "trainer", ref: t.algoId, title: `trainer: ${t.title}`, reason: "leitner due" });
  }

  // one stretch problem at the top of the ceiling in a strong topic
  for (const t of input.strongTopics.slice(0, PLAN_STRETCH_COUNT)) {
    const { ranked } = rankCandidates(input.ctx, input.candidates, {
      onlyTopics: new Set([t]), limit: 10, hiddenKeys: input.hiddenKeys,
    });
    const top = [...ranked].sort((a, b) => (b.difficulty ?? 0) - (a.difficulty ?? 0))[0];
    if (top) {
      drafts.push({ kind: "stretch", ref: top.key, title: top.title, reason: top.reason });
    }
  }

  // revisit stuck problems
  const revisits = input.stuckKeys
    .filter((key) => !input.hiddenKeys.has(key))
    .slice(0, Math.max(1, Math.round(PLAN_REVISIT_COUNT * scale)));
  for (const key of revisits) {
    drafts.push({ kind: "revisit", ref: key, title: titleOf(input.titles, key), reason: "stuck list" });
  }

  // pre-contest warmup on contest days (light days, see distribution)
  for (const day of input.contestDays) {
    drafts.push({
      kind: "warmup", ref: `contest-day-${day}`,
      title: "pre-contest warmup", reason: "contest scheduled",
      fixedDay: day,
    });
  }

  return distribute(input.weekStart, drafts, input.doneRefs);
}

function distribute(weekStart: string, drafts: Draft[], doneRefs: Set<string>): PlanItem[] {
  const days: PlanItem[][] = [[], [], [], [], [], [], []];
  const reviewsOn = [0, 0, 0, 0, 0, 0, 0];
  let seq = 0;
  const place = (d: Draft, day: number) => {
    days[day].push({
      id: `${weekStart}-d${day}-${d.kind}-${seq++}`,
      day, kind: d.kind, ref: d.ref, title: d.title, reason: d.reason,
      done: doneRefs.has(d.ref), doneAt: undefined,
    });
  };
  // fixed-day warmups first
  for (const d of drafts.filter((x) => x.fixedDay != null)) {
    place(d, d.fixedDay as number);
  }
  // rest day (default Saturday index 5? PLAN_REST_DAY) fills last
  const order = [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== PLAN_REST_DAY).concat([PLAN_REST_DAY]);
  for (const d of drafts.filter((x) => x.fixedDay == null)) {
    for (const day of order) {
      const isContestDay = days[day].some((it) => it.kind === "warmup");
      if (days[day].length >= PLAN_MAX_PER_DAY) continue;
      if (isContestDay && days[day].length >= 2) continue; // contest days stay light
      if (d.kind === "review" && reviewsOn[day] >= PLAN_MAX_REVIEWS_PER_DAY) continue;
      if (day === PLAN_REST_DAY && days[day].length > 0 && d.kind !== "review") continue; // rest day stays light
      place(d, day);
      if (d.kind === "review") reviewsOn[day]++;
      break;
    }
  }
  return days.flat();
}
