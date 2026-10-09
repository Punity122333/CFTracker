import { describe, expect, it } from "vitest";
import { cfQueue, _resetForTests, CF_MIN_GAP_MS } from "./rateLimit";

describe("rateLimit", () => {
  it("serializes calls with a gap", async () => {
    _resetForTests();
    const order: number[] = [];
    const t0 = Date.now();
    await Promise.all([
      cfQueue(async () => { order.push(Date.now() - t0); return 1; }),
      cfQueue(async () => { order.push(Date.now() - t0); return 2; }),
    ]);
    expect(order).toHaveLength(2);
    expect(order[1] - order[0]).toBeGreaterThanOrEqual(CF_MIN_GAP_MS - 50);
  });
  it("keeps queue alive after rejection", async () => {
    _resetForTests();
    await expect(cfQueue(async () => { throw new Error("x"); })).rejects.toThrow();
    await expect(cfQueue(async () => 42)).resolves.toBe(42);
  });
});
