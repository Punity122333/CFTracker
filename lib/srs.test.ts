import { describe, expect, it } from "vitest";
import { scheduleReviews, isOverdue, upsolveFirst } from "./srs";

describe("srs", () => {
  it("schedules reviews at 3, 14, 30 days", () => {
    const t = Date.UTC(2026, 0, 1);
    const due = scheduleReviews(t);
    const day = 24 * 3600 * 1000;
    expect(due).toEqual([t + 3 * day, t + 14 * day, t + 30 * day]);
  });
  it("detects overdue", () => {
    const t = 1000;
    expect(isOverdue([500], t)).toBe(true);
    expect(isOverdue([5000], t)).toBe(false);
  });
  it("resurfaces due reviews first in the upsolve section", () => {
    const items = [{ problemKey: "a" }, { problemKey: "b" }, { problemKey: "c" }];
    expect(upsolveFirst(items, new Set(["c", "a"])).map((i) => i.problemKey)).toEqual(["a", "c", "b"]);
    expect(upsolveFirst(items, new Set()).map((i) => i.problemKey)).toEqual(["a", "b", "c"]);
  });
});
