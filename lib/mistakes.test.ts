import { describe, expect, it } from "vitest";
import { checklistFor, mistakeStats, topicsForMistake } from "./mistakes";

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86400000;

describe("mistakeStats", () => {
  it("finds the dominant category above share and count thresholds", () => {
    const ms = [
      ...Array.from({ length: 6 }, (_, i) => ({ category: "overflow", timestamp: NOW - i * DAY })),
      ...Array.from({ length: 4 }, (_, i) => ({ category: "TLE", timestamp: NOW - i * DAY })),
    ];
    const s = mistakeStats(ms, NOW);
    expect(s.total).toBe(10);
    expect(s.dominant).toBe("overflow");
    expect(s.share).toBe(0.6);
  });
  it("stays quiet below thresholds or outside the window", () => {
    const few = Array.from({ length: 4 }, () => ({ category: "overflow", timestamp: NOW }));
    expect(mistakeStats(few, NOW).dominant).toBeNull();
    const old = Array.from({ length: 10 }, () => ({ category: "overflow", timestamp: NOW - 90 * DAY }));
    expect(mistakeStats(old, NOW).dominant).toBeNull();
    expect(mistakeStats([], NOW).dominant).toBeNull();
  });
  it("serves checklists and topic mappings", () => {
    expect(checklistFor("overflow").length).toBeGreaterThanOrEqual(3);
    expect(topicsForMistake("overflow")).toContain("modarith");
    expect(topicsForMistake("TLE")).toContain("binsearch");
    expect(checklistFor("nope")).toEqual([]);
  });
});
