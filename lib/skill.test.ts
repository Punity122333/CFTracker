import { describe, expect, it } from "vitest";
import {
  atcoderToCF,
  classifyContestSubmissions,
  estimateGlobal,
  estimateTopicAbility,
  isoWeekKey,
  nextRamp,
  nudgeOffset,
  problemTheta,
  softminTheta,
  solveBasedEstimate,
  solveQuality,
  targetWindow,
  topicPrior,
} from "./skill";
import type { TopicDef } from "./topics";

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 8);

function topic(id: string, group = "graphs", prereqs: string[] = []): TopicDef {
  return {
    id, name: id, group, prerequisites: prereqs,
    codeforcesTags: [], ratingRange: [1000, 2000], description: "", resources: [],
  };
}

describe("estimateGlobal", () => {
  it("comfortRating overrides everything", () => {
    const e = estimateGlobal({ comfortRating: 1250, contestRating: 1800, unaidedSolves: [], nowMs: NOW });
    expect(e.theta).toBe(1250);
    expect(e.source).toBe("comfort");
  });
  it("takes min of contest rating and solve estimate, never the max", () => {
    const solves = Array.from({ length: 12 }, (_, i) => ({ difficulty: 1300, timestamp: NOW - i * DAY }));
    const e = estimateGlobal({ contestRating: 1800, unaidedSolves: solves, nowMs: NOW });
    expect(e.source).toBe("min-rating-solves");
    expect(e.theta).toBeLessThanOrEqual(1300);
    expect(e.theta).toBeLessThan(1800);
  });
  it("contest rating 1500 with solve estimate 1200 gives 1200", () => {
    const solves = Array.from({ length: 12 }, (_, i) => ({ difficulty: 1250, timestamp: NOW - i * DAY }));
    const e = estimateGlobal({ contestRating: 1500, unaidedSolves: solves, nowMs: NOW });
    expect(e.theta).toBe(1200);
  });
  it("contest rating alone below the cap is used as-is", () => {
    expect(estimateGlobal({ contestRating: 1300, unaidedSolves: [], nowMs: NOW }).theta).toBe(1300);
  });
  it("contest rating alone above the cap is discounted, not hard-capped", () => {
    const e = estimateGlobal({ contestRating: 1500, unaidedSolves: [], nowMs: NOW });
    expect(e.source).toBe("contest-only");
    expect(e.theta).toBe(1300);
  });
  it("cold start is 800 with no data", () => {
    const e = estimateGlobal({ unaidedSolves: [], nowMs: NOW });
    expect(e.theta).toBe(800);
    expect(e.source).toBe("cold-start");
  });
  it("solve estimate needs 5 rated solves", () => {
    const few = Array.from({ length: 4 }, () => ({ difficulty: 2000, timestamp: NOW }));
    expect(solveBasedEstimate(few, NOW)).toBeNull();
  });
});

describe("progressive estimate", () => {
  it("30 accepted 800-1300 with no todos estimates ~1100-1250, not 800", () => {
    const solves = Array.from({ length: 30 }, (_, i) => ({
      difficulty: 800 + Math.round((i / 29) * 500),
      timestamp: NOW - (i % 30) * DAY,
    }));
    const e = estimateGlobal({ unaidedSolves: solves, nowMs: NOW });
    expect(e.source).toBe("solves-only");
    expect(e.theta).toBeGreaterThanOrEqual(1050);
    expect(e.theta).toBeLessThanOrEqual(1250);
    expect(e.theta).not.toBe(800);
  });
  it("200-day-old solves still estimate via the widened window", () => {
    const solves = Array.from({ length: 10 }, (_, i) => ({
      difficulty: 1200, timestamp: NOW - 200 * DAY - i * DAY,
    }));
    const e = estimateGlobal({ unaidedSolves: solves, nowMs: NOW });
    expect(e.source).toBe("solves-only");
    expect(e.estimateWindow).toBe("365d");
    expect(e.theta).toBe(1150);
  });
  it("missing difficulties are skipped without zeroing the rest", () => {
    const solves = Array.from({ length: 8 }, (_, i) => ({
      difficulty: 1200, timestamp: NOW - i * DAY,
    }));
    // caller drops unrated entries before calling; the rated remainder estimates
    const e = estimateGlobal({ unaidedSolves: solves, nowMs: NOW });
    expect(e.source).toBe("solves-only");
    expect(e.estimateCount).toBe(8);
  });
});

describe("atcoderToCF", () => {
  it("is monotone increasing", () => {
    const vals = [0, 100, 400, 600, 800, 1000, 1200, 1600, 2000, 2400, 3000];
    const mapped = vals.map(atcoderToCF);
    for (let i = 1; i < mapped.length; i++) {
      expect(mapped[i]).toBeGreaterThanOrEqual(mapped[i - 1]);
    }
  });
  it("lands on the CF scale, not raw values", () => {
    expect(atcoderToCF(400)).toBeGreaterThanOrEqual(800);
    expect(atcoderToCF(1200)).toBeGreaterThan(1200);
    expect(atcoderToCF(0)).toBe(800);
  });
});

describe("estimateTopicAbility", () => {
  it("failures lower theta, unaided solves raise it", () => {
    const fails = Array.from({ length: 4 }, (_, i) => ({
      difficulty: 1050, solved: false, aided: false, stuck: false,
      timestamp: NOW - i * DAY, key: `g${i}`,
    }));
    const low = estimateTopicAbility(1250, 1250, fails, NOW);
    const solves = Array.from({ length: 4 }, (_, i) => ({
      difficulty: 1950, solved: true, aided: false, stuck: false,
      timestamp: NOW - i * DAY, key: `b${i}`,
    }));
    const high = estimateTopicAbility(1250, 1250, solves, NOW);
    expect(low.theta).toBeLessThan(1250);
    expect(high.theta).toBeGreaterThan(1250);
  });
  it("collapses repeated failures on one problem to one", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      difficulty: 1000, solved: false, aided: false, stuck: false,
      timestamp: NOW - i * 1000, key: "same",
    }));
    const one = estimateTopicAbility(1250, 1250, many, NOW);
    expect(one.failures).toBe(1);
  });
  it("clamps within [global-500, global+500]", () => {
    const solves = Array.from({ length: 30 }, (_, i) => ({
      difficulty: 3000, solved: true, aided: false, stuck: false,
      timestamp: NOW - i * DAY, key: `s${i}`,
    }));
    const e = estimateTopicAbility(1250, 3000, solves, NOW);
    expect(e.theta).toBeLessThanOrEqual(1750);
  });
  it("override wins but is clamped", () => {
    const e = estimateTopicAbility(1250, 1250, [], NOW, 3000);
    expect(e.theta).toBe(1750);
    expect(e.overridden).toBe(true);
  });
  it("untouched topic sits below its fallback", () => {
    const e = estimateTopicAbility(1250, Number.NaN, [], NOW);
    expect(e.theta).toBeLessThan(1250);
  });
});

describe("topicPrior", () => {
  it("uses prerequisites first, then peers, never above global implicitly", () => {
    const topics = [topic("dfs"), topic("bfs"), topic("dijkstra", "graphs", ["bfs"])];
    const thetas = new Map([["bfs", 1100]]);
    expect(topicPrior(topics[2], topics, thetas)).toBe(1100);
    expect(topicPrior(topics[0], topics, new Map())).toBeNaN();
  });
});

describe("softminTheta", () => {
  it("judges multi-topic problems by the weaker topic", () => {
    const s = softminTheta([1950, 1050]);
    expect(s).toBeLessThan(1300);
    expect(s).toBeGreaterThanOrEqual(1050);
  });
  it("single topic passes through", () => {
    expect(softminTheta([1400])).toBe(1400);
  });
  it("problemTheta falls back to global with no topics", () => {
    expect(problemTheta([], new Map(), 1250)).toBe(1250);
  });
});

describe("targetWindow", () => {
  it("matches the documented examples", () => {
    expect(targetWindow(1050, 100)).toEqual([1100, 1250]);
  });
});

describe("solveQuality", () => {
  const base = {
    hintLevelUsed: 0, solvedWithoutHelp: true,
    logicWritten: true, acceptedCodePresent: false, hasSubmission: true,
  };
  it("applies each ladder weight", () => {
    expect(solveQuality(base)).toEqual({ level: "unaided", weight: 1 });
    expect(solveQuality({ ...base, hintLevelUsed: 1 }).weight).toBe(0.9);
    expect(solveQuality({ ...base, hintLevelUsed: 2 }).weight).toBe(0.7);
    expect(solveQuality({ ...base, hintLevelUsed: 3 }).weight).toBe(0.4);
    expect(solveQuality({ ...base, solvedWithoutHelp: false, logicWritten: false }).weight).toBe(0.25);
  });
  it("synced solves with no todo data are unaided", () => {
    expect(solveQuality(base).weight).toBe(1);
  });
  it("honors an explicit override", () => {
    expect(solveQuality({ ...base, override: "editorial" })).toEqual({ level: "editorial", weight: 0.4 });
  });
});

describe("nudgeOffset", () => {
  const week = isoWeekKey(NOW);
  it("moves the offset and accumulates weekly drift", () => {
    const r = nudgeOffset(100, undefined, 0, week, 25);
    expect(r).toEqual({ offset: 125, weekKey: week, drift: 25 });
  });
  it("caps weekly drift and resets on a new week", () => {
    const r = nudgeOffset(100, week, 40, week, 25);
    expect(r.offset).toBe(110);
    expect(r.drift).toBe(50);
    const next = nudgeOffset(110, week, 50, "2099-01-04", -25);
    expect(next).toEqual({ offset: 85, weekKey: "2099-01-04", drift: 25 });
  });
  it("never leaves the hard-filter limits", () => {
    expect(nudgeOffset(190, undefined, 0, week, 25).offset).toBe(200);
    expect(nudgeOffset(10, undefined, 0, week, -25).offset).toBe(0);
  });
});

describe("classifyContestSubmissions", () => {
  const end = NOW;
  const windows = { "1234": end };
  const subs = [
    { problemKey: "codeforces:1234A", verdict: "OK", timestamp: end - 3600000, contestId: 1234 },
    { problemKey: "codeforces:1234B", verdict: "WA", timestamp: end - 3600000, contestId: 1234 },
    { problemKey: "codeforces:1234C", verdict: "WA", timestamp: end - 3600000, contestId: 1234 },
    { problemKey: "codeforces:1234C", verdict: "OK", timestamp: end + 86400000, contestId: 1234 },
    { problemKey: "codeforces:1234D", verdict: "WA", timestamp: end + 86400000, contestId: 1234 },
  ];
  it("classifies solves, failures and upsolves with weights", () => {
    const m = classifyContestSubmissions(subs, windows);
    expect(m.get("codeforces:1234A")).toEqual({ kind: "in-contest-solve", weight: 1.25 });
    expect(m.get("codeforces:1234B")?.kind).toBe("in-contest-fail");
    expect(m.get("codeforces:1234B")?.weight).toBe(1);
    expect(m.get("codeforces:1234C")?.kind).toBe("upsolve");
    expect(m.get("codeforces:1234C")?.weight).toBeLessThan(0.5);
    // never attempted in-contest: no evidence
    expect(m.get("codeforces:1234D")).toBeUndefined();
  });
});

describe("nextRamp", () => {
  it("raises the target after 3 unaided streak, caps at stretch", () => {
    let s = { offset: 100, streak: 0 };
    s = nextRamp(s.offset, s.streak, true);
    s = nextRamp(s.offset, s.streak, true);
    expect(s.streak).toBe(2);
    s = nextRamp(s.offset, s.streak, true);
    expect(s).toEqual({ offset: 150, streak: 0 });
    let cap = { offset: 190, streak: 2 };
    cap = nextRamp(cap.offset, cap.streak, true);
    expect(cap.offset).toBe(200);
  });
  it("lowers after 2 failures", () => {
    let s = { offset: 100, streak: 0 };
    s = nextRamp(s.offset, s.streak, false);
    s = nextRamp(s.offset, s.streak, false);
    expect(s).toEqual({ offset: 50, streak: 0 });
  });
  it("a failure resets a success streak", () => {
    const s = nextRamp(100, 2, false);
    expect(s).toEqual({ offset: 100, streak: -1 });
  });
});
