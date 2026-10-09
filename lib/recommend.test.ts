import { describe, expect, it } from "vitest";
import { contestOf, seededIndex, surprisePick, rankCandidates, type RankContext } from "./recommend";

function ctx(): RankContext {
  return { globalTheta: 1250, topics: new Map(), studyNext: new Set() };
}

describe("ranker helpers", () => {
  it("extracts contest groups for diversity", () => {
    expect(contestOf("codeforces:1234A")).toBe("cf:1234");
    expect(contestOf("atcoder:abc214:abc214_f")).toBe("atcoder:abc214");
    expect(contestOf("cses:1633")).toBe("cses");
  });
  it("seededIndex is deterministic and in range", () => {
    const a = seededIndex("2026-10-08|tourist", 20);
    expect(seededIndex("2026-10-08|tourist", 20)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(20);
  });
  it("surprisePick draws from the same filtered ranking", () => {
    const pool = [
      { key: "cf:1200A", title: "a", platform: "codeforces", difficulty: 1200, tags: ["dp"], topicIds: ["dpbasics"], url: "u", solved: false, attempted: false, inTodo: false },
      { key: "cf:3500A", title: "b", platform: "codeforces", difficulty: 3500, tags: ["dp"], topicIds: ["dpbasics"], url: "u", solved: false, attempted: true, inTodo: false },
    ];
    const { ranked } = rankCandidates(ctx(), pool);
    const pick = surprisePick("seed1", ranked);
    expect(pick?.key).toBe("cf:1200A");
    expect(surprisePick("seed1", ranked)?.key).toBe(pick?.key);
  });
});
