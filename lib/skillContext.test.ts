import { describe, expect, it, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { buildSkillSnapshot, levelLine, backfillAbility, maybeSnapshot, recordFeedback, recordTopicOutcome, weeklyDeltas } from "./skillContext";

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86400000;

async function seedSyncedHistory() {
  // 6 distinct CF problems, difficulties 1000-1500, all accepted recently.
  // One problem has 3 duplicate accepted submissions (counts once).
  // One accepted problem has no difficulty row (skipped, not zeroing).
  const probs = [1000, 1100, 1200, 1300, 1400, 1500];
  for (let i = 0; i < probs.length; i++) {
    await db().problems.add({
      key: `codeforces:100${i}A`, platform: "codeforces", pid: `100${i}A`,
      title: `p${i}`, difficulty: probs[i], tags: ["dp"], url: "u", updatedAt: NOW,
    });
    await db().submissions.add({
      platform: "codeforces", problemKey: `codeforces:100${i}A`, verdict: "OK",
      timestamp: NOW - i * DAY, submissionId: `s${i}`,
    });
  }
  await db().submissions.add({
    platform: "codeforces", problemKey: "codeforces:1000A", verdict: "OK",
    timestamp: NOW - 10 * DAY, submissionId: "dup1",
  });
  await db().submissions.add({
    platform: "codeforces", problemKey: "codeforces:1000A", verdict: "OK",
    timestamp: NOW - 11 * DAY, submissionId: "dup2",
  });
  await db().problems.add({
    key: "codeforces:999Z", platform: "codeforces", pid: "999Z",
    title: "unrated", tags: ["dp"], url: "u", updatedAt: NOW,
  });
  await db().submissions.add({
    platform: "codeforces", problemKey: "codeforces:999Z", verdict: "OK",
    timestamp: NOW, submissionId: "unrated1",
  });
  await db().settings.add({
    cfHandle: "tourist", atcoderHandle: "", csesUser: "",
    difficultyLow: 0, difficultyHigh: 300, weeklyGoal: 5, stuckTimeoutMinutes: 45,
  });
  await db().syncMeta.add({ platform: "codeforces", lastSyncAt: NOW });
}

describe("recordTopicOutcome", () => {
  beforeEach(async () => {
    await db().delete().catch(() => undefined);
    await db().open().catch(() => undefined);
    await db().problems.add({
      key: "codeforces:1A", platform: "codeforces", pid: "1A",
      title: "t", difficulty: 1000, tags: ["dp"], url: "u", updatedAt: 1,
    });
  });

  it("raises the topic offset after 3 unaided solves, lowers on failures", async () => {
    await recordTopicOutcome("codeforces:1A", true);
    await recordTopicOutcome("codeforces:1A", true);
    await recordTopicOutcome("codeforces:1A", true);
    let row = await db().topicState.where("topicId").equals("dpbasics").first();
    expect(row?.targetOffset).toBe(150);
    await recordTopicOutcome("codeforces:1A", false);
    await recordTopicOutcome("codeforces:1A", false);
    row = await db().topicState.where("topicId").equals("dpbasics").first();
    expect(row?.targetOffset).toBe(100);
  });
});

describe("feedback evidence", () => {
  beforeEach(async () => {
    await db().delete().catch(() => undefined);
    await db().open().catch(() => undefined);
    await db().settings.add({
      cfHandle: "", atcoderHandle: "", csesUser: "",
      difficultyLow: 0, difficultyHigh: 300, weeklyGoal: 5,
      stuckTimeoutMinutes: 45, comfortRating: 1250,
    });
    await db().problems.add({
      key: "codeforces:1500A", platform: "codeforces", pid: "1500A",
      title: "a", difficulty: 1500, tags: [], url: "u", updatedAt: NOW,
    });
    await db().problems.add({
      key: "codeforces:1500B", platform: "codeforces", pid: "1500B",
      title: "b", difficulty: 1500, tags: [], url: "u", updatedAt: NOW,
    });
    await db().manualTags.add({ problemKey: "codeforces:1500A", tags: ["dpbasics"] });
    await db().manualTags.add({ problemKey: "codeforces:1500B", tags: ["dijkstra"] });
  });

  it("easy raises ability and offset, hard lowers both", async () => {
    await recordFeedback({ problemKey: "codeforces:1500A", rating: "easy", source: "todo" });
    await recordFeedback({ problemKey: "codeforces:1500B", rating: "hard", source: "todo" });
    const snap = await buildSkillSnapshot();
    const a = snap.thetaByTopic.get("dpbasics") ?? 0;
    const b = snap.thetaByTopic.get("dijkstra") ?? 0;
    expect(a).toBeGreaterThan(b);
    expect(snap.perTopic.get("dpbasics")?.feedback).toEqual({ easy: 1, right: 0, hard: 0 });
    expect(snap.perTopic.get("dijkstra")?.feedback).toEqual({ easy: 0, right: 0, hard: 1 });
    const rows = await db().topicState.toArray();
    const offsets = new Map(rows.map((r) => [r.topicId, r.targetOffset]));
    expect(offsets.get("dpbasics")).toBe(125);
    expect(offsets.get("dijkstra")).toBe(75);
  });
});

describe("ability history", () => {
  beforeEach(async () => {
    await db().delete().catch(() => undefined);
    await db().open().catch(() => undefined);
  });

  it("snapshots at most once per day (idempotent)", async () => {
    await maybeSnapshot();
    await maybeSnapshot();
    expect(await db().abilitySnapshots.count()).toBe(1);
  });

  it("backfill produces monotone dates and bounded work", async () => {
    for (let w = 0; w < 30; w++) {
      await db().submissions.add({
        platform: "codeforces", problemKey: `codeforces:9${w}A`, verdict: "OK",
        timestamp: NOW - w * 7 * DAY, submissionId: `h${w}`,
      });
      await db().problems.add({
        key: `codeforces:9${w}A`, platform: "codeforces", pid: `9${w}A`,
        title: `p${w}`, difficulty: 1000 + (w % 5) * 100, tags: ["dp"], url: "u", updatedAt: NOW,
      });
    }
    const n = await backfillAbility();
    expect(n).toBe(26);
    const rows = await db().abilitySnapshots.orderBy("date").toArray();
    expect(rows).toHaveLength(26);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].date >= rows[i - 1].date).toBe(true);
    }
  });

  it("weeklyDeltas handles gaps", () => {
    const deltas = weeklyDeltas(
      [
        { date: "2026-08-01", globalTheta: 1100, topicThetas: { dpbasics: 1000 } },
        { date: "2026-10-08", globalTheta: 1250, topicThetas: { dpbasics: 1200 } },
      ],
      new Map([["dpbasics", 1200]])
    );
    expect(deltas).toEqual([{ id: "dpbasics", now: 1200, delta: 200 }]);
    expect(weeklyDeltas([], new Map())).toEqual([]);
  });
});

describe("synced-history estimate", () => {
  beforeEach(async () => {
    await db().delete().catch(() => undefined);
    await db().open().catch(() => undefined);
    await seedSyncedHistory();
  });

  it("estimates from synced submissions with no todo items (not 800)", async () => {
    const snap = await buildSkillSnapshot();
    expect(snap.global.source).toBe("solves-only");
    expect(snap.global.theta).toBeGreaterThan(1000);
    expect(snap.global.theta).not.toBe(800);
    // duplicates count once: 6 rated problems in window
    expect(snap.global.estimateCount).toBe(6);
    expect(snap.estimator.acceptedProblems).toBe(7); // +1 unrated
    expect(snap.estimator.withDifficulty).toBe(6);
    expect(snap.estimator.handleSet).toBe(true);
    expect(snap.estimator.lastSyncAt).toBe(NOW);
  });

  it("submission keys join the problems table (codeforces:contestId+index)", async () => {
    const snap = await buildSkillSnapshot();
    // all 6 rated accepts resolved to a difficulty
    expect(snap.estimator.withDifficulty).toBe(snap.estimator.acceptedProblems - 1);
  });

  it("level line tells the truth; cold-start line only with no data", async () => {
    const snap = await buildSkillSnapshot();
    expect(levelLine(snap)).toMatch(/estimated from 6 solved problems/);
    // wipe everything: cold start mentions sync
    await db().submissions.clear();
    await db().problems.clear();
    await db().settings.clear();
    const cold = await buildSkillSnapshot();
    expect(cold.global.source).toBe("cold-start");
    expect(levelLine(cold)).toMatch(/no handle set yet/);
  });
});
