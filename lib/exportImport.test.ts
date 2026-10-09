import { describe, expect, it, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db, EXPORT_VERSION } from "./db";
import { exportAll, importAll } from "./exportImport";

describe("export/import", () => {
  beforeEach(async () => {
    await db().delete().catch(() => undefined);
    // reopen after delete
    await db().open().catch(() => undefined);
  });

  it("round-trips all tables with schema version", async () => {
    const d = db();
    await d.problems.add({
      key: "codeforces:1A",
      platform: "codeforces",
      pid: "1A",
      title: "Theatre Square",
      difficulty: 1000,
      tags: ["math"],
      url: "https://codeforces.com/problemset/problem/1/A",
      updatedAt: 1,
    });
    await d.todoItems.add({
      problemKey: "codeforces:1A",
      solved: true,
      implemented: true,
      understood: false,
      solvedWithoutHelp: false,
      stuck: false,
      hintLevelUsed: 0,
      logic: "obs",
      acceptedCode: "",
      keyTrick: "",
      selfCheck: { observation: true, complexity: false, edgeCases: false },
      timerSeconds: 60,
      addedAt: 1,
    });
    await d.snippets.add({ title: "dSU", tags: ["dsu"], code: "struct" });
    await d.trainerStats.add({
      algoId: "dsu", mode: "blank", attempts: 2, correct: 1,
      box: 2, dueAt: 999, lastSeenAt: 998, lastResult: "correct",
    });
    await d.feedback.add({
      problemKey: "codeforces:1A", topicIds: ["dpbasics"], difficulty: 1000,
      rating: "hard", source: "todo", timestamp: 2,
    });
    await d.hiddenProblems.add({ problemKey: "codeforces:9Z", reason: "tooHard", timestamp: 3 });
    await d.plans.add({ weekStart: "2026-10-06", items: [] });
    await d.warmups.add({ startedAt: 4, problemKeys: ["a"], solvedKeys: [], durationSec: 60 });
    await d.abilitySnapshots.add({ date: "2026-10-08", globalTheta: 1200, topicThetas: { dpbasics: 1100 }, source: "auto" });
    await d.submissions.add({
      platform: "codeforces",
      problemKey: "codeforces:1A",
      verdict: "OK",
      language: "C++17",
      timestamp: 1,
      contestId: 1,
      submissionId: "123",
    });
    // regression: submissionId must be an indexed keypath (sync dedupe)
    expect(await d.submissions.where("submissionId").equals("123").count()).toBe(1);

    const blob = await exportAll();
    expect(blob.version).toBe(EXPORT_VERSION);
    expect(blob.tables["problems"]).toHaveLength(1);

    await d.problems.clear();
    await d.todoItems.clear();
    await d.snippets.clear();
    await d.trainerStats.clear();
    await d.feedback.clear();
    await d.hiddenProblems.clear();
    await d.plans.clear();
    await d.warmups.clear();
    await d.abilitySnapshots.clear();
    expect(await d.problems.count()).toBe(0);

    await importAll(blob);
    expect(await d.problems.count()).toBe(1);
    expect(await d.todoItems.count()).toBe(1);
    expect(await d.snippets.count()).toBe(1);
    expect(await d.trainerStats.count()).toBe(1);
    expect(await d.feedback.count()).toBe(1);
    expect(await d.hiddenProblems.count()).toBe(1);
    expect(await d.plans.count()).toBe(1);
    expect(await d.warmups.count()).toBe(1);
    expect(await d.abilitySnapshots.count()).toBe(1);
  });

  it("migrates a v2 export (no Phase 6 tables) to v3", async () => {
    const d = db();
    await importAll({ version: 2, exportedAt: 0, tables: { problems: [], trainerStats: [] } });
    expect(await d.feedback.count()).toBe(0);
    expect(await d.hiddenProblems.count()).toBe(0);
    expect(await d.plans.count()).toBe(0);
    expect(await d.warmups.count()).toBe(0);
    expect(await d.abilitySnapshots.count()).toBe(0);
  });

  it("migrates a v1 blob (no trainerStats) to v2", async () => {
    const d = db();
    await importAll({ version: 1, exportedAt: 0, tables: { problems: [] } });
    expect(await d.trainerStats.count()).toBe(0);
    expect(await d.problems.count()).toBe(0);
  });

  it("rejects bad files and future versions", async () => {
    // @ts-expect-error testing bad input
    await expect(importAll({})).rejects.toThrow();
    await expect(
      importAll({ version: 999, exportedAt: 0, tables: {} })
    ).rejects.toThrow();
  });
});
