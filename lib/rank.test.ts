import { describe, expect, it } from "vitest";
import {
  applyHardFilters,
  dailyPick,
  nextRungs,
  rankCandidates,
  warmupPicks,
  type Candidate,
  type RankContext,
} from "./recommend";
import { absoluteCeiling, estimateTopicAbility } from "./skill";

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86400000;

function cand(key: string, difficulty: number | undefined, topicIds: string[], extra: Partial<Candidate> = {}): Candidate {
  return {
    key, title: key, platform: "codeforces", difficulty,
    tags: topicIds, topicIds, url: `u/${key}`,
    solved: false, attempted: false, inTodo: false, ...extra,
  };
}

function ctx(globalTheta: number, thetas: Record<string, { theta: number; solves?: number; attempts?: number; failures?: number }> = {}): RankContext {
  const topics = new Map(
    Object.entries(thetas).map(([id, v]) => [
      id,
      { theta: v.theta, solves: v.solves ?? 0, attempts: v.attempts ?? 0, failures: v.failures ?? 0, offset: 100 },
    ])
  );
  return { globalTheta, topics, studyNext: new Set() };
}

// Permanent regression test (STEP 1): user theta 1250, pool 800-3500.
describe("3500 regression", () => {
  const pool = [
    cand("cf:800A", 800, ["dp"]),
    cand("cf:1400A", 1400, ["dp"]),
    cand("cf:1600A", 1600, ["dp"]),
    cand("cf:2400A", 2400, ["dp"], { attempted: true }),
    cand("cf:3500A", 3500, ["dp"], { attempted: true }),
  ];
  it("no path returns anything above the absolute ceiling", () => {
    const c = ctx(1250);
    const { ranked } = rankCandidates(c, pool);
    for (const r of ranked) {
      expect(r.difficulty ?? 0).toBeLessThanOrEqual(absoluteCeiling(1250));
    }
  });
  it("with no topic evidence, nothing above global + stretch", () => {
    const c = ctx(1250);
    const { ranked } = rankCandidates(c, pool);
    for (const r of ranked) {
      expect(r.difficulty ?? 0).toBeLessThanOrEqual(1450);
    }
    expect(ranked.length).toBeGreaterThan(0);
  });
});

describe("topic-aware core case", () => {
  // binary search solved at 1900-2100, graphs failed at 1000-1100, global 1250
  const bsEvidence = Array.from({ length: 6 }, (_, i) => ({
    difficulty: 1950 + (i % 3) * 50, solved: true, aided: false, stuck: false,
    timestamp: NOW - i * DAY, key: `bs${i}`,
  }));
  const gEvidence = Array.from({ length: 5 }, (_, i) => ({
    difficulty: 1000 + (i % 2) * 100, solved: false, aided: false, stuck: false,
    timestamp: NOW - i * DAY, key: `g${i}`,
  }));
  const bs = estimateTopicAbility(1250, 1250, bsEvidence, NOW);
  const g = estimateTopicAbility(1250, 1250, gEvidence, NOW);

  it("learns high binary search and low graphs ability", () => {
    expect(bs.theta).toBeGreaterThan(1400);
    expect(g.theta).toBeLessThan(1250);
  });

  it("offers binary search near 2000-window, graphs near/below ~1050", () => {
    const c = ctx(1250, {
      binsearch: { theta: bs.theta, solves: 6, attempts: 6, failures: 0 },
      graphs: { theta: g.theta, solves: 0, attempts: 5, failures: 5 },
    });
    const pool = [
      ...[1500, 1700, 1800, 1900, 1950, 2100].map((d, i) => cand(`cf:9${i}A`, d, ["binsearch"])),
      ...[800, 900, 1000, 1100, 1200, 1300].map((d, i) => cand(`cf:8${i}B`, d, ["graphs"])),
    ];
    const { ranked } = rankCandidates(c, pool, { limit: 10 });
    const bsRecs = ranked.filter((r) => r.topicIds.includes("binsearch"));
    const gRecs = ranked.filter((r) => r.topicIds.includes("graphs"));
    expect(bsRecs.length).toBeGreaterThan(0);
    expect(gRecs.length).toBeGreaterThan(0);
    for (const r of gRecs) {
      expect(r.difficulty ?? 0).toBeLessThanOrEqual(g.theta + 200);
    }
    // binary search recs sit higher than graph recs
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(bsRecs.map((r) => r.difficulty ?? 0))).toBeGreaterThan(
      avg(gRecs.map((r) => r.difficulty ?? 0))
    );
  });
});

describe("softmin judging", () => {
  it("a binsearch+graphs problem is judged by the weaker topic", () => {
    const c = ctx(1250, {
      binsearch: { theta: 1700, solves: 6, attempts: 6, failures: 0 },
      graphs: { theta: 1050, solves: 0, attempts: 5, failures: 5 },
    });
    const pool = [cand("cf:1200X", 1200, ["binsearch", "graphs"])];
    const { ranked } = rankCandidates(c, pool);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].thetaProblem).toBeLessThan(1300);
    // and a 1500 version is correctly out of reach for effective ~1074
    expect(rankCandidates(c, [cand("cf:1500X", 1500, ["binsearch", "graphs"])]).ranked).toHaveLength(0);
  });
});

describe("hard filters", () => {
  it("attempted-but-unsolved bonus cannot override the ceiling", () => {
    const c = ctx(1250);
    const pool = [cand("cf:3500A", 3500, ["dp"], { attempted: true })];
    const { ranked, report } = rankCandidates(c, pool);
    expect(ranked).toHaveLength(0);
    expect(report.droppedWindow).toBe(1);
  });
  it("excludes solved, in-todo, and unrated by default", () => {
    const c = ctx(1250);
    const pool = [
      cand("cf:1200A", 1200, ["dp"], { solved: true }),
      cand("cf:1200B", 1200, ["dp"], { inTodo: true }),
      cand("cf:1200C", undefined, ["dp"]),
      cand("cf:1200D", 1200, ["dp"]),
    ];
    const { ranked, report } = rankCandidates(c, pool);
    expect(ranked.map((r) => r.key)).toEqual(["cf:1200D"]);
    expect(report.droppedSolved).toBe(1);
    expect(report.droppedInTodo).toBe(1);
    expect(report.droppedUnrated).toBe(1);
  });
  it("includeUnrated toggle lets unrated through", () => {
    const c = ctx(1250);
    const pool = [cand("cses:1633", undefined, ["dpbasics"])];
    expect(rankCandidates(c, pool).ranked).toHaveLength(0);
    expect(rankCandidates(c, pool, { includeUnrated: true }).ranked).toHaveLength(1);
  });
  it("scarcity returns fewer without widening", () => {
    const c = ctx(1250);
    const pool = [cand("cf:1300A", 1300, ["dp"]), cand("cf:3500A", 3500, ["dp"])];
    const { ranked } = rankCandidates(c, pool, { limit: 5 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].difficulty).toBe(1300);
  });
  it("respects the floor too", () => {
    const c = ctx(2000, { dp: { theta: 2000, solves: 5, attempts: 5, failures: 0 } });
    const pool = [cand("cf:800A", 800, ["dp"])];
    expect(rankCandidates(c, pool).ranked).toHaveLength(0);
  });
});

describe("diversity", () => {
  it("a list of 5 is not 5 of one topic when alternatives exist", () => {
    const c = ctx(1250, {
      dp: { theta: 1250, solves: 2, attempts: 5, failures: 3 },
      graphs: { theta: 1250, solves: 2, attempts: 5, failures: 0 },
    });
    const pool = [
      ...Array.from({ length: 8 }, (_, i) => cand(`cf:12${i}A`, 1200 + (i % 3) * 50, ["dp"])),
      ...Array.from({ length: 8 }, (_, i) => cand(`cf:13${i}B`, 1200 + (i % 3) * 50, ["graphs"])),
    ];
    const { ranked } = rankCandidates(c, pool, { limit: 5 });
    const topics = new Set(ranked.flatMap((r) => r.topicIds));
    expect(topics.size).toBeGreaterThan(1);
  });
});

describe("daily pick", () => {
  const pool = [
    cand("cf:1200A", 1200, ["dp"]),
    cand("cf:1300B", 1300, ["dp"]),
    cand("cf:1400C", 1400, ["dp"]),
  ];
  it("is stable for a date+handle and differs across dates", () => {
    const c = ctx(1250);
    const { ranked } = rankCandidates(c, pool);
    const a1 = dailyPick("2026-10-08", "tourist", ranked);
    const a2 = dailyPick("2026-10-08", "tourist", ranked);
    expect(a1?.key).toBe(a2?.key);
    const otherDates = new Set(
      ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
       "2026-10-06", "2026-10-07", "2026-10-09", "2026-10-10", "2026-10-11"]
        .map((d) => dailyPick(d, "tourist", ranked)?.key)
    );
    expect(otherDates.size).toBeGreaterThan(1);
  });
});

describe("hidden problems", () => {
  it("a hidden problem never appears from any ranker path", () => {
    const c = ctx(1250);
    const pool = [
      cand("cf:1200A", 1200, ["dp"]),
      cand("cf:1300B", 1300, ["dp"]),
    ];
    const hidden = new Set(["cf:1200A", "cf:1300B"]);
    const { ranked, report } = rankCandidates(c, pool, { hiddenKeys: hidden });
    expect(ranked).toHaveLength(0);
    expect(report.droppedHidden).toBe(2);
    // daily and surprise draw from the same ranked list
    expect(dailyPick("2026-10-08", "h", ranked)).toBeNull();
  });
});

describe("never-again filter", () => {
  it("drops hidden keys with a report count", () => {
    const c = ctx(1250);
    const { report } = applyHardFilters(
      [cand("cf:1200A", 1200, ["dp"])],
      c, { hiddenKeys: new Set(["cf:1200A"]) }
    );
    expect(report.kept).toBe(0);
    expect(report.droppedHidden).toBe(1);
  });
});

describe("topic restriction", () => {
  it("restricts practice sets to one topic", () => {
    const c = ctx(1250, {
      dp: { theta: 1250, solves: 1, attempts: 2, failures: 0 },
      graphs: { theta: 1250, solves: 1, attempts: 2, failures: 0 },
    });
    const pool = [
      cand("cf:1200A", 1200, ["dp"]),
      cand("cf:1200B", 1200, ["graphs"]),
    ];
    const { ranked } = rankCandidates(c, pool, { onlyTopics: new Set(["dp"]), limit: 5 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].topicIds).toContain("dp");
  });
});

describe("applyHardFilters report", () => {
  it("counts every drop reason", () => {
    const c = ctx(1250);
    const { report } = applyHardFilters(
      [cand("cf:3500A", 3500, ["dp"]), cand("cf:1200A", 1200, ["dp"])],
      c, {}
    );
    expect(report.kept).toBe(1);
    expect(report.droppedWindow).toBe(1);
  });
});

describe("next rungs", () => {
  const pool = [
    cand("cf:1000A", 1000, ["graphs"]),
    cand("cf:1075B", 1075, ["graphs"]),
    cand("cf:1150C", 1150, ["graphs"]),
    cand("cf:1225D", 1225, ["graphs"]),
    cand("cf:1300E", 1300, ["graphs"]),
  ];
  const c = () => ctx(1250, {
    graphs: { theta: 1050, solves: 2, attempts: 9, failures: 7 },
  });
  it("climbs by rung steps inside the hard filters", () => {
    const { rungs, targets, note } = nextRungs(c(), pool, {
      topicIds: ["graphs"], solvedDifficulty: 1000, mode: "climb",
    });
    expect(targets).toEqual([1075, 1150]);
    expect(note).toBeNull();
    expect(rungs.map((r) => r.difficulty)).toEqual([1075, 1150]);
    for (const r of rungs) {
      expect(r.difficulty ?? 0).toBeLessThanOrEqual(1050 + 200);
    }
  });
  it("assisted solves stay level or go lower", () => {
    const { rungs, targets, note } = nextRungs(c(), pool, {
      topicIds: ["graphs"], solvedDifficulty: 1000, mode: "same",
    });
    expect(targets).toEqual([1000, 950]);
    expect(note).toMatch(/same level/);
    expect(rungs[0].difficulty).toBe(1000);
  });
  it("easy feedback climbs double", () => {
    const { targets } = nextRungs(c(), pool, {
      topicIds: ["graphs"], solvedDifficulty: 1000, mode: "fast",
    });
    expect(targets).toEqual([1150, 1300]);
  });
});

describe("warmup picks", () => {
  it("picks below-level problems from distinct topics through the filters", () => {
    const c = ctx(1400, {
      dp: { theta: 1400, solves: 3, attempts: 5, failures: 0 },
      graphs: { theta: 1100, solves: 1, attempts: 4, failures: 3 },
      impl: { theta: 1400, solves: 3, attempts: 3, failures: 0 },
    });
    const pool = [
      cand("cf:1200A", 1200, ["dp"]),
      cand("cf:1200B", 1200, ["dp"]),
      cand("cf:1000C", 1000, ["graphs"]),
      cand("cf:1250D", 1250, ["impl"]),
      cand("cf:3000E", 3000, ["dp"]),
    ];
    const picks = warmupPicks(c, pool, 3, 150);
    expect(picks).toHaveLength(3);
    const topics = new Set(picks.flatMap((p) => p.topicIds));
    expect(topics.size).toBe(3);
    for (const p of picks) {
      expect(p.difficulty ?? 0).toBeLessThanOrEqual(1400 + 500 + 200);
    }
  });
  it("returns fewer with a plain small pool", () => {
    const c = ctx(1400);
    const picks = warmupPicks(c, [cand("cf:1200A", 1200, ["dp"])], 3, 150);
    expect(picks).toHaveLength(1);
  });
});

describe("mistake bias", () => {
  it("favors dominant-mistake topics but cannot violate filters", () => {
    const base = ctx(1250, {
      dp: { theta: 1250, solves: 2, attempts: 5, failures: 1 },
      greedy: { theta: 1250, solves: 2, attempts: 5, failures: 1 },
    });
    const biased: RankContext = {
      ...base, mistakeTopics: new Set(["greedy"]), mistakeLabel: "wrong greedy",
    };
    const pool = [
      cand("cf:1250A", 1250, ["dp"]),
      cand("cf:1250B", 1250, ["greedy"]),
      cand("cf:3500C", 3500, ["greedy"]),
    ];
    const { ranked } = rankCandidates(biased, pool, { limit: 5 });
    expect(ranked[0].topicIds).toContain("greedy");
    expect(ranked[0].mistakeBoost).toBe(true);
    expect(ranked[0].reason).toMatch(/top mistake/);
    expect(ranked.map((r) => r.key)).not.toContain("cf:3500C");
  });
});
