import { describe, expect, it } from "vitest";
import {
  blanksForBox,
  dueAfterBox,
  orderLinesForBox,
  rankTrainerCandidates,
  updateBox,
  type Blank,
} from "./trainer";

const blanks: Blank[] = [
  { prompt: "easy", template: "a ___", answer: "a", weight: 1 },
  { prompt: "mid", template: "b ___", answer: "b", weight: 2 },
  { prompt: "hard", template: "c ___", answer: "c", weight: 3 },
];

describe("trainer boxes", () => {
  it("correct moves up, wrong drops to 1, partly stays", () => {
    expect(updateBox(1, "correct")).toBe(2);
    expect(updateBox(5, "correct")).toBe(5);
    expect(updateBox(4, "wrong")).toBe(1);
    expect(updateBox(3, "partly")).toBe(3);
  });
  it("due dates follow box intervals", () => {
    const now = 1000;
    expect(dueAfterBox(1, now)).toBe(now + 86400000);
    expect(dueAfterBox(5, now)).toBe(now + 30 * 86400000);
  });
  it("difficulty scales with box", () => {
    expect(blanksForBox(blanks, 1).map((b) => b.weight)).toEqual([1]);
    expect(blanksForBox(blanks, 2).map((b) => b.weight)).toEqual([1, 2]);
    expect(blanksForBox(blanks, 5).map((b) => b.weight)).toEqual([1, 2, 3]);
  });
  it("reorder adds lines then distractors with box", () => {
    const lines = ["a", "b", "c", "d", "e"];
    expect(orderLinesForBox(lines, ["x", "y"], 1)).toEqual({ lines: ["a", "b", "c"], hasDistractors: false });
    expect(orderLinesForBox(lines, ["x", "y"], 5).hasDistractors).toBe(true);
  });
});

describe("trainer selection", () => {
  const algos = [
    { algoId: "easy-dsu", topicId: "dsu", rangeLo: 1400 },
    { algoId: "hard-fft", topicId: "fft", rangeLo: 2300 },
    { algoId: "skipped-x", topicId: "heap", rangeLo: 1100 },
  ];
  const base = {
    globalTheta: 1250, weakTopics: new Set<string>(), activeTopics: new Set<string>(),
    skippedTopics: new Set(["heap"]), maxStretch: 200, nowMs: 1000,
  };
  it("skips out-of-range and skipped topics", () => {
    const out = rankTrainerCandidates(algos, new Map(), base);
    expect(out.map((a) => a.algoId)).toEqual(["easy-dsu"]);
  });
  it("due items come first", () => {
    const algos2 = [
      { algoId: "a", topicId: "dsu", rangeLo: 1400 },
      { algoId: "b", topicId: "dsu", rangeLo: 1400 },
    ];
    const stats = new Map([
      ["a", { box: 3, dueAt: 999, seen: true }],
      ["b", { box: 3, dueAt: 99999, seen: true }],
    ]);
    const out = rankTrainerCandidates(algos2, stats, { ...base, skippedTopics: new Set() });
    expect(out[0].algoId).toBe("a");
  });
});
