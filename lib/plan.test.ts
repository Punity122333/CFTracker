import { describe, expect, it } from "vitest";
import { buildPlanItems, type PlanInput } from "./plan";
import type { Candidate, RankContext } from "./recommend";

function cand(key: string, difficulty: number, topicIds: string[]): Candidate {
  return {
    key, title: key, platform: "codeforces", difficulty,
    tags: topicIds, topicIds, url: `u/${key}`,
    solved: false, attempted: false, inTodo: false,
  };
}

function ctx(): RankContext {
  const topics = new Map([
    ["graphs", { theta: 1050, solves: 2, attempts: 9, failures: 7, offset: 100 }],
    ["dpbasics", { theta: 1400, solves: 6, attempts: 8, failures: 0, offset: 100 }],
    ["binsearch", { theta: 1700, solves: 8, attempts: 9, failures: 0, offset: 100 }],
  ]);
  return { globalTheta: 1250, topics, studyNext: new Set(["dpbasics"]) };
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    weekStart: "2026-10-05",
    handle: "tourist",
    ctx: ctx(),
    candidates: [
      ...[900, 1000, 1100, 1150, 1200].map((d, i) => cand(`cf:g${i}`, d, ["graphs"])),
      ...[1400, 1500, 1550].map((d, i) => cand(`cf:d${i}`, d, ["dpbasics"])),
      ...[1800, 1900].map((d, i) => cand(`cf:b${i}`, d, ["binsearch"])),
    ],
    hiddenKeys: new Set(),
    weakTopics: ["graphs"],
    studyNextTopic: "dpbasics",
    studyNextTitle: "DP basics",
    reviewsDueKeys: ["cf:g0", "cf:g1", "cf:g2", "cf:g3", "cf:g4", "cf:d0", "cf:d1"],
    stuckKeys: ["cf:g4"],
    trainerDue: [{ algoId: "dsu", title: "Disjoint set union" }],
    strongTopics: ["binsearch"],
    contestDays: [5],
    weeklyGoal: 5,
    doneRefs: new Set(),
    titles: new Map(),
    ...over,
  };
}

describe("buildPlanItems", () => {
  it("respects per-day caps and keeps the rest day light", () => {
    const items = buildPlanItems(input());
    const byDay = new Map<number, number>();
    for (const it of items) byDay.set(it.day, (byDay.get(it.day) ?? 0) + 1);
    for (const [, n] of byDay) expect(n).toBeLessThanOrEqual(4);
    const reviews = items.filter((it) => it.kind === "review");
    const revByDay = new Map<number, number>();
    for (const it of reviews) revByDay.set(it.day, (revByDay.get(it.day) ?? 0) + 1);
    for (const [, n] of revByDay) expect(n).toBeLessThanOrEqual(3);
  });
  it("is deterministic for a week and handle", () => {
    const a = buildPlanItems(input());
    const b = buildPlanItems(input());
    expect(a.map((it) => `${it.day}:${it.kind}:${it.ref}`)).toEqual(
      b.map((it) => `${it.day}:${it.kind}:${it.ref}`)
    );
  });
  it("regenerate keeps done items done", () => {
    const first = buildPlanItems(input());
    const withDone = buildPlanItems(input({ doneRefs: new Set([first[0].ref]) }));
    expect(withDone.find((it) => it.ref === first[0].ref)?.done).toBe(true);
  });
  it("all plan problems pass the hard filters; hidden never appear", () => {
    const items = buildPlanItems(input({ hiddenKeys: new Set(["cf:g0"]) }));
    expect(items.map((it) => it.ref)).not.toContain("cf:g0");
    for (const it of items) {
      if (["weak", "new-topic-practice", "stretch"].includes(it.kind)) {
        const c = input().candidates.find((x) => x.key === it.ref)!;
        expect(c.difficulty ?? 0).toBeLessThanOrEqual(1250 + 500 + 200);
      }
    }
  });
  it("contest day gets a warmup and stays light", () => {
    const items = buildPlanItems(input());
    const day5 = items.filter((it) => it.day === 5);
    expect(day5.some((it) => it.kind === "warmup")).toBe(true);
    expect(day5.length).toBeLessThanOrEqual(2);
  });
});
