"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db, getSettings, type PlanItem } from "@/lib/db";
import {
  buildCandidates,
  buildSkillSnapshot,
  loadHiddenKeys,
  rankContextFromSnapshot,
  type SkillSnapshot,
} from "@/lib/skillContext";
import { buildPlanItems } from "@/lib/plan";
import { cfContests } from "@/lib/platforms/codeforces";
import algos from "@/data/algorithms.json";

function mondayOf(nowMs: number): string {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function PlanPage() {
  return (
    <Suspense>
      <PlanInner />
    </Suspense>
  );
}

function PlanInner() {
  const params = useSearchParams();
  const [weekStart] = useState(() => mondayOf(Date.now()));
  const [items, setItems] = useState<PlanItem[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const plan = await db().plans.where("weekStart").equals(mondayOf(Date.now())).first();
    setItems(plan?.items ?? []);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (params.get("generate") === "1") {
      db().plans.where("weekStart").equals(mondayOf(Date.now())).first().then((p) => {
        if (!p) void generate();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function generate() {
    setBusy(true);
    setMsg("building plan…");
    try {
      const d = db();
      const [snap, cands, hidden, settings] = await Promise.all([
        buildSkillSnapshot(), buildCandidates(), loadHiddenKeys(), getSettings(),
      ]);
      const probs = await d.problems.toArray();
      const titleMap = new Map(probs.map((p) => [p.key, { title: p.title, url: p.url }]));
      const now = Date.now();
      const reviewsDueKeys = (await d.reviews.toArray())
        .filter((r) => r.dueDates.some((x) => x <= now))
        .map((r) => r.problemKey);
      const stuckKeys = (await d.todoItems.toArray()).filter((t) => t.stuck).map((t) => t.problemKey);
      const algoTitles = new Map(
        ((algos as { algorithms: { id: string; title: string }[] }).algorithms).map((a) => [a.id, a.title])
      );
      const trainerDue = (await d.trainerStats.toArray())
        .filter((t) => t.dueAt <= now)
        .map((t) => ({ algoId: t.algoId, title: algoTitles.get(t.algoId) ?? t.algoId }));
      const weakTopics = [...snap.thetaByTopic]
        .map(([id, theta]) => ({ id, gap: snap.global.theta - theta }))
        .filter((x) => x.gap > 0)
        .sort((a, b) => b.gap - a.gap)
        .map((x) => x.id);
      const strongTopics = [...snap.thetaByTopic]
        .filter(([, t]) => t > snap.global.theta)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
      const studyNextId = [...snap.studyNextIds][0] ?? null;
      const studyNextTitle = studyNextId
        ? snap.topics.find((t) => t.id === studyNextId)?.name ?? studyNextId
        : "";
      // upcoming CF contests inside this week
      const contestDays: number[] = [];
      try {
        const contests = await cfContests();
        const weekEnd = new Date(`${weekStart}T00:00:00Z`).getTime() + 7 * 86400000;
        for (const c of contests) {
          if (c.phase !== "BEFORE") continue;
          if (c.start >= new Date(`${weekStart}T00:00:00Z`).getTime() && c.start < weekEnd) {
            const day = Math.floor((c.start - new Date(`${weekStart}T00:00:00Z`).getTime()) / 86400000);
            if (day >= 0 && day < 7 && !contestDays.includes(day)) contestDays.push(day);
          }
        }
      } catch {
        // calendar unavailable: plan without contest days
      }
      const existing = await d.plans.where("weekStart").equals(weekStart).first();
      const doneRefs = new Set((existing?.items ?? []).filter((it) => it.done).map((it) => it.ref));
      const built = buildPlanItems({
        weekStart,
        handle: settings.cfHandle || settings.atcoderHandle || "local",
        ctx: rankContextFromSnapshot(snap as SkillSnapshot),
        candidates: cands,
        hiddenKeys: hidden,
        weakTopics,
        studyNextTopic: studyNextId,
        studyNextTitle,
        reviewsDueKeys,
        stuckKeys,
        trainerDue,
        strongTopics,
        contestDays,
        weeklyGoal: settings.weeklyGoal,
        doneRefs,
        titles: titleMap,
      });
      if (existing?.id) await d.plans.update(existing.id, { items: built });
      else await d.plans.add({ weekStart, items: built });
      setItems(built);
      setMsg(`plan ready: ${built.length} items`);
    } catch (e) {
      setMsg(`plan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: PlanItem) {
    const plan = await db().plans.where("weekStart").equals(weekStart).first();
    if (!plan?.id) return;
    const items2 = plan.items.map((it) =>
      it.id === item.id ? { ...it, done: !it.done, doneAt: !it.done ? Date.now() : undefined } : it
    );
    await db().plans.update(plan.id, { items: items2 });
    setItems(items2);
  }

  const days: PlanItem[][] = [[], [], [], [], [], [], []];
  for (const it of items) days[Math.min(6, Math.max(0, it.day))].push(it);

  function linkFor(it: PlanItem): string {
    if (it.kind === "trainer") return "/trainer";
    if (it.kind === "new-topic-read") return `/topics#topic-${it.ref}`;
    if (it.kind === "warmup") return "/contests";
    return `/topics`;
  }

  return (
    <div>
      <h1>plan</h1>
      <p className="sub">one week from {weekStart}, built from your level and due items. regenerating keeps done items.</p>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={generate}>generate plan</button>
        {msg && <span className="small muted">{msg}</span>}
      </div>
      {days.map((list, day) => (
        <section key={day}>
          <h2>{DAY_NAMES[day]} {day === 6 ? "(lighter day)" : ""}</h2>
          {list.length === 0 && <p className="small muted">nothing.</p>}
          <ul className="plain">
            {list.map((it) => (
              <li key={it.id} className="small">
                <label className="row">
                  <input type="checkbox" checked={it.done} onChange={() => toggle(it)} />
                  <span className="muted mono">{it.kind}</span>
                  {it.kind === "trainer" || it.kind === "new-topic-read" || it.kind === "warmup" ? (
                    <a href={linkFor(it)}>{it.title}</a>
                  ) : (
                    <ProblemLink itemKey={it.ref} title={it.title} />
                  )}
                </label>
                {it.reason && <div className="muted">{it.reason}</div>}
                {(it.kind === "weak" || it.kind === "new-topic-practice" || it.kind === "stretch" || it.kind === "revisit" || it.kind === "review") && (
                  <AddToTodo problemKey={it.ref} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ProblemLink({ itemKey, title }: { itemKey: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    db().problems.get(itemKey).then((p) => setUrl(p?.url ?? null));
  }, [itemKey]);
  if (!url) return <span>{title}</span>;
  return <a href={url} target="_blank" rel="noreferrer">{title}</a>;
}

function AddToTodo({ problemKey }: { problemKey: string }) {
  return (
    <button className="btn" onClick={async () => {
      const n = await db().todoItems.where("problemKey").equals(problemKey).count();
      if (n === 0) {
        await db().todoItems.add({
          problemKey, solved: false, implemented: false, understood: false,
          solvedWithoutHelp: false, stuck: false, hintLevelUsed: 0, logic: "",
          acceptedCode: "", keyTrick: "", selfCheck: { observation: false, complexity: false, edgeCases: false },
          timerSeconds: 0, addedAt: Date.now(),
        });
      }
    }}>add to todo</button>
  );
}
