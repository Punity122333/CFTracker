import { describe, expect, it } from "vitest";
import {
  deriveStatus,
  effectiveStatus,
  problemsForTopic,
  topicStats,
  rankStudyNext,
  type TopicDef,
} from "./topics";

const dp: TopicDef = {
  id: "dpbasics",
  name: "DP basics",
  group: "dp",
  prerequisites: [],
  codeforcesTags: ["dp"],
  ratingRange: [1000, 1700],
  description: "d",
  resources: [],
};
const treedp: TopicDef = {
  id: "treedp",
  name: "Tree DP",
  group: "trees",
  prerequisites: ["treebasics", "dpbasics"],
  codeforcesTags: ["trees", "dp"],
  ratingRange: [1500, 2300],
  description: "d",
  resources: [],
};
const treebasics: TopicDef = {
  id: "treebasics",
  name: "Tree basics",
  group: "trees",
  prerequisites: ["dfs"],
  codeforcesTags: ["trees"],
  ratingRange: [1200, 1900],
  description: "d",
  resources: [],
};

describe("topics", () => {
  it("derives statuses by thresholds (weighted solves)", () => {
    expect(deriveStatus({ solved: 0, attempted: 0, solveRate: 0, weightedSolved: 0 })).toBe("not started");
    expect(deriveStatus({ solved: 1, attempted: 5, solveRate: 0.2, weightedSolved: 1 })).toBe("learning");
    expect(deriveStatus({ solved: 4, attempted: 8, solveRate: 0.5, weightedSolved: 4 })).toBe("practicing");
    expect(deriveStatus({ solved: 9, attempted: 10, solveRate: 0.9, weightedSolved: 9 })).toBe("solid");
    // 10 trivial solves below the floor do not make a topic solid
    expect(deriveStatus({ solved: 10, attempted: 10, solveRate: 1, weightedSolved: 2 })).toBe("learning");
  });
  it("respects manual override and skip", () => {
    expect(effectiveStatus("learning", "learned", false)).toBe("learned");
    expect(effectiveStatus("solid", undefined, true)).toBe("skipped");
  });
  it("gates study-next on prerequisites", () => {
    const topics = [dp, treebasics, treedp];
    const status = new Map([
      ["dpbasics", "practicing"],
      ["treebasics", "learning"],
      ["treedp", "not started"],
    ]);
    const solved = new Map([["dpbasics", 1], ["treebasics", 1], ["treedp", 0]]);
    const ranked = rankStudyNext({
      topics, statusById: status, solvedById: solved,
      weightedById: solved, thetaByTopic: new Map(), globalTheta: 1500,
    });
    expect(ranked.map((r) => r.topic.id)).not.toContain("treedp");
  });
  it("excludes topics far above the user's level (no FFT for 1250)", () => {
    const fft: TopicDef = {
      ...dp, id: "fft", name: "FFT", ratingRange: [2300, 3000], prerequisites: [],
    };
    const ranked = rankStudyNext({
      topics: [dp, fft],
      statusById: new Map([["dpbasics", "learning"], ["fft", "not started"]]),
      solvedById: new Map([["dpbasics", 0], ["fft", 0]]),
      weightedById: new Map([["dpbasics", 0], ["fft", 0]]),
      thetaByTopic: new Map(),
      globalTheta: 1250,
    });
    expect(ranked.map((r) => r.topic.id)).not.toContain("fft");
    expect(ranked.map((r) => r.topic.id)).toContain("dpbasics");
  });
  it("ranks weak topics by ability gap first", () => {
    const weak: TopicDef = { ...dp, id: "graphs", name: "Graphs", prerequisites: [] };
    const ranked = rankStudyNext({
      topics: [dp, weak],
      statusById: new Map([["dpbasics", "learning"], ["graphs", "learning"]]),
      solvedById: new Map([["dpbasics", 1], ["graphs", 1]]),
      weightedById: new Map([["dpbasics", 1], ["graphs", 1]]),
      thetaByTopic: new Map([["dpbasics", 1400], ["graphs", 1050]]),
      globalTheta: 1250,
    });
    expect(ranked[0].topic.id).toBe("graphs");
    expect(ranked[0].reason).toMatch(/1050/);
  });
  it("weights trivial solves down in topicStats", () => {
    const easy = Array.from({ length: 10 }, (_, i) => ({
      key: `cf:7${i}A`, platform: "codeforces" as const, tags: ["dp"] as string[],
      topicIds: [], solved: true, attempted: true, difficulty: 700,
    }));
    const stats = topicStats(easy, 1000);
    expect(stats.solved).toBe(10);
    expect(stats.weightedSolved).toBeCloseTo(3, 5);
  });
  it("counts CSES per-problem ids and manual tags; AtCoder untagged does not count", () => {
    const problems = [
      { key: "cses:1633", platform: "cses" as const, tags: [] as string[], topicIds: ["dpbasics"], solved: true, attempted: true },
      { key: "atcoder:abc:xyz", platform: "atcoder" as const, tags: [] as string[], topicIds: [], solved: true, attempted: true },
      { key: "codeforces:1A", platform: "codeforces" as const, tags: ["dp"], topicIds: [], solved: false, attempted: true },
    ];
    const manual = new Map<string, string[]>([]);
    const matched = problemsForTopic(dp, problems, manual);
    expect(matched.map((p) => p.key)).toContain("cses:1633");
    expect(matched.map((p) => p.key)).toContain("codeforces:1A");
    expect(matched.map((p) => p.key)).not.toContain("atcoder:abc:xyz");
    // manual tag makes atcoder count
    const manual2 = new Map([["atcoder:abc:xyz", ["dpbasics"]]]);
    const matched2 = problemsForTopic(dp, problems, manual2);
    expect(matched2.map((p) => p.key)).toContain("atcoder:abc:xyz");
    const stats = topicStats(matched);
    expect(stats.solved).toBe(1);
    expect(stats.attempted).toBe(2);
  });
});
