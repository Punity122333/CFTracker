// Adaptive pseudocode trainer: Leitner boxes + box-scaled difficulty.
// Pure helpers; the page persists trainerStats rows in Dexie.

import { TRAINER_BOX_INTERVALS, TRAINER_MAX_BOX } from "./tuning";

export type TrainerResult = "correct" | "partly" | "wrong";

export interface Blank {
  prompt: string;
  template: string;
  answer: string;
  weight: number; // 1-3, harder key steps weigh more
}

// Box transitions: correct moves up, wrong drops to 1, partly stays.
export function updateBox(box: number, result: TrainerResult): number {
  if (result === "correct") return Math.min(TRAINER_MAX_BOX, box + 1);
  if (result === "wrong") return 1;
  return Math.min(TRAINER_MAX_BOX, Math.max(1, box));
}

export function dueAfterBox(box: number, nowMs: number): number {
  const days = TRAINER_BOX_INTERVALS[Math.min(box, TRAINER_MAX_BOX) - 1] ?? 1;
  return nowMs + days * 86400000;
}

// Difficulty scales with box: low box sees only easy blanks (weight 1),
// mid box adds weight-2, high box uses all blanks.
export function blanksForBox(blanks: Blank[], box: number): Blank[] {
  const maxWeight = box <= 1 ? 1 : box <= 3 ? 2 : 3;
  const picked = blanks.filter((b) => b.weight <= maxWeight);
  return picked.length > 0 ? picked : blanks.slice(0, 1);
}

// Reorder scaling: low box = first 3 lines, no distractors; mid = 4 lines;
// high box = all lines + up to 2 plausible distractors.
export function orderLinesForBox(
  lines: string[],
  distractors: string[],
  box: number
): { lines: string[]; hasDistractors: boolean } {
  if (box <= 1) return { lines: lines.slice(0, Math.min(3, lines.length)), hasDistractors: false };
  if (box <= 3) return { lines: lines.slice(0, Math.min(4, lines.length)), hasDistractors: false };
  return { lines, hasDistractors: distractors.length > 0 };
}

export interface TrainerPick {
  algoId: string;
  topicId: string;
  rangeLo: number;
}

export interface TrainerRank {
  box: number;
  dueAt: number;
  seen: boolean;
}

// Selection order: (1) due by dueAt, (2) topics learning/practicing or
// below global, (3) in-reach lower bounds, (4) never-seen. Out-of-range
// and skipped topics never surface.
export function rankTrainerCandidates(
  algos: TrainerPick[],
  stats: Map<string, TrainerRank>,
  opts: {
    globalTheta: number;
    weakTopics: Set<string>;
    activeTopics: Set<string>;
    skippedTopics: Set<string>;
    maxStretch: number;
    nowMs: number;
  }
): TrainerPick[] {
  const eligible = algos.filter((a) => {
    if (opts.skippedTopics.has(a.topicId)) return false;
    if (a.rangeLo > opts.globalTheta + opts.maxStretch) return false;
    return true;
  });
  const scored = eligible.map((a) => {
    const st = stats.get(a.algoId);
    const due = st ? st.dueAt <= opts.nowMs : false;
    const active = opts.activeTopics.has(a.topicId) || opts.weakTopics.has(a.topicId);
    const inReach = a.rangeLo <= opts.globalTheta + opts.maxStretch;
    const neverSeen = !st;
    // due first, then active/weak, then in-reach, then unseen; stable by id
    const score = (due ? 1000 : 0) + (active ? 100 : 0) + (inReach ? 10 : 0) + (neverSeen ? 1 : 0);
    return { a, score, dueAt: st?.dueAt ?? 0 };
  });
  scored.sort((x, y) => y.score - x.score || x.dueAt - y.dueAt || (x.a.topicId < y.a.topicId ? -1 : 1));
  return scored.map((s) => s.a);
}
