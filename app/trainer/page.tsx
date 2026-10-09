"use client";

import { useEffect, useMemo, useState } from "react";
import algos from "@/data/algorithms.json";
import { db } from "@/lib/db";
import { MAX_STRETCH } from "@/lib/tuning";
import { buildCandidates, buildSkillSnapshot, loadHiddenKeys, rankContextFromSnapshot, type SkillSnapshot } from "@/lib/skillContext";
import { rankCandidates, type Candidate } from "@/lib/recommend";
import {
  blanksForBox,
  dueAfterBox,
  orderLinesForBox,
  rankTrainerCandidates,
  updateBox,
  type TrainerResult,
} from "@/lib/trainer";

interface Algo {
  id: string;
  title: string;
  topicId: string;
  reference: string;
  blanks: { prompt: string; template: string; answer: string; weight: number }[];
  distractors: string[];
  lines: string[];
}

interface StatRow {
  box: number;
  dueAt: number;
  attempts: number;
  correct: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Trainer() {
  const list = (algos as { algorithms: Algo[] }).algorithms;
  const [snap, setSnap] = useState<SkillSnapshot | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Map<string, StatRow>>(new Map());
  const [algoId, setAlgoId] = useState<string | null>(null);
  const [mode, setMode] = useState<"write" | "blank" | "order">("write");
  const [typed, setTyped] = useState("");
  const [showRef, setShowRef] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [pool, setPool] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [graded, setGraded] = useState<string | null>(null);
  const [timed, setTimed] = useState(false);
  const [secs, setSecs] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  async function reload() {
    const [s, c, h] = await Promise.all([buildSkillSnapshot(), buildCandidates(), loadHiddenKeys()]);
    setSnap(s);
    setCands(c);
    setHidden(h);
    const rows = await db().trainerStats.toArray();
    const m = new Map<string, StatRow>();
    for (const r of rows) m.set(`${r.algoId}:${r.mode}`, { box: r.box, dueAt: r.dueAt, attempts: r.attempts, correct: r.correct });
    setStats(m);
  }

  useEffect(() => { reload(); }, []);

  const ordered = useMemo(() => {
    if (!snap) return [];
    const active = new Set(
      [...snap.perTopic].filter(([, s]) => s.status === "learning" || s.status === "practicing").map(([id]) => id)
    );
    const weak = new Set(
      [...snap.thetaByTopic].filter(([, t]) => t < snap.global.theta).map(([id]) => id)
    );
    const skipped = new Set(
      [...snap.perTopic].filter(([, s]) => s.status === "skipped").map(([id]) => id)
    );
    const byId = new Map(snap.topics.map((t) => [t.id, t]));
    return rankTrainerCandidates(
      list.map((a) => ({ algoId: a.id, topicId: a.topicId, rangeLo: byId.get(a.topicId)?.ratingRange[0] ?? 0 })),
      new Map([...stats].map(([k, v]) => [k.split(":")[0], { box: v.box, dueAt: v.dueAt, seen: true }])),
      {
        globalTheta: snap.global.theta, weakTopics: weak, activeTopics: active,
        skippedTopics: skipped, maxStretch: MAX_STRETCH, nowMs: Date.now(),
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, stats]);

  const dueCount = useMemo(() => {
    if (!snap) return 0;
    const now = Date.now();
    return ordered.filter((o) => {
      const st = [...stats].find(([k]) => k.startsWith(`${o.algoId}:`));
      return !st || st[1].dueAt <= now;
    }).length;
  }, [ordered, stats, snap]);

  const algo = list.find((a) => a.id === algoId) ?? (ordered[0] ? list.find((a) => a.id === ordered[0].algoId)! : list[0]);
  const statKey = `${algo.id}:${mode}`;
  const box = stats.get(statKey)?.box ?? 1;

  // reset per-item state when algo/mode/box changes
  useEffect(() => {
    setShowRef(false);
    setTyped("");
    setAnswers({});
    setGraded(null);
    setSecs(0);
    const { lines, hasDistractors } = orderLinesForBox(algo.lines, algo.distractors, box);
    setPool(shuffle(hasDistractors ? [...lines, ...algo.distractors.slice(0, 2)] : lines));
    setPicked([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algo.id, mode, box]);

  useEffect(() => {
    if (!timed) return;
    const iv = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [timed]);

  async function record(result: TrainerResult) {
    const d = db();
    const now = Date.now();
    const prev = (await d.trainerStats.toArray()).find((r) => r.algoId === algo.id && r.mode === mode);
    const nextBox = updateBox(prev?.box ?? 1, result);
    const data = {
      algoId: algo.id, mode,
      attempts: (prev?.attempts ?? 0) + 1,
      correct: (prev?.correct ?? 0) + (result === "correct" ? 1 : 0),
      box: nextBox, dueAt: dueAfterBox(nextBox, now), lastSeenAt: now, lastResult: result,
    };
    if (prev?.id) await d.trainerStats.update(prev.id, data);
    else await d.trainerStats.add(data);
    await reload();
  }

  const blanks = blanksForBox(algo.blanks, box);
  const blankCorrect = blanks.every((b, i) => (answers[i] ?? "").trim() === b.answer);
  const orderCorrect = picked.length > 0 && picked.every((l, i) => algo.lines[i] === l) &&
    picked.length === orderLinesForBox(algo.lines, algo.distractors, box).lines.length;

  const related = useMemo(() => {
    if (!snap) return [];
    return rankCandidates(
      rankContextFromSnapshot(snap),
      cands, { onlyTopics: new Set([algo.topicId]), limit: 3, hiddenKeys: hidden }
    ).ranked;
  }, [snap, cands, algo.topicId, hidden]);

  return (
    <div>
      <h1>trainer</h1>
      <p className="sub">
        write, fill-in-the-blank, reorder. {list.length} seeded algorithms.{" "}
        {dueCount > 0 ? `${dueCount} due today.` : "nothing due — ahead of schedule."}
      </p>
      <div className="row small">
        <button className="btn" onClick={() => setMode("write")}>A write</button>
        <button className="btn" onClick={() => setMode("blank")}>B blank</button>
        <button className="btn" onClick={() => setMode("order")}>C reorder</button>
        <button className="btn" onClick={() => {
          const i = ordered.findIndex((o) => o.algoId === algo.id);
          const next = ordered[(i + 1) % Math.max(1, ordered.length)];
          if (next) setAlgoId(next.algoId);
        }}>next (adaptive order)</button>
        <label className="row"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> timed</label>
        {timed && <span className="mono">{secs}s</span>}
        <span className="muted small mono">box {box} · {algo.topicId}</span>
      </div>

      <section>
        <h2>{algo.title} <span className="muted small">(<a href="/topics">{algo.topicId}</a>)</span></h2>
        {mode === "write" && (
          <div>
            <textarea rows={8} placeholder="write the pseudocode from memory" value={typed} onChange={(e) => setTyped(e.target.value)} className="mono" />
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => setShowRef(!showRef)}>{showRef ? "hide" : "reveal"} reference</button>
            </div>
            {showRef && (
              <div>
                <div className="row" style={{ alignItems: "flex-start", marginTop: 8 }}>
                  <pre className="mono small" style={{ flex: 1, whiteSpace: "pre-wrap" }}>yours:{`\n${typed}`}</pre>
                  <pre className="mono small" style={{ flex: 1, whiteSpace: "pre-wrap" }}>reference:{`\n${algo.reference}`}</pre>
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn" onClick={() => { record("correct"); setGraded("recorded: got it"); }}>got it</button>
                  <button className="btn" onClick={() => { record("partly"); setGraded("recorded: partly"); }}>partly</button>
                  <button className="btn" onClick={() => { record("wrong"); setGraded("recorded: missed"); }}>missed</button>
                  {graded && <span className="small muted">{graded}</span>}
                </div>
              </div>
            )}
          </div>
        )}
        {mode === "blank" && (
          <div>
            {blanks.map((b, i) => (
              <div key={i} style={{ marginTop: 6 }}>
                <p className="small">{b.prompt}</p>
                <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>{b.template}</pre>
                <input type="text" placeholder="your answer" value={answers[i] ?? ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} style={{ marginTop: 4 }} />
              </div>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => {
                const ok = blankCorrect;
                setShowRef(true);
                record(ok ? "correct" : "wrong");
              }}>check</button>
              {showRef && <span className="small mono">{blankCorrect ? "correct" : `expected: ${blanks.map((b) => b.answer).join(" / ")}`}</span>}
            </div>
          </div>
        )}
        {mode === "order" && (
          <div>
            <p className="small">click lines in order, click again to take back:</p>
            <ul className="plain">
              {pool.map((l) => (
                <li key={l}><button className="btn" onClick={() => { setPool(pool.filter((x) => x !== l)); setPicked([...picked, l]); }}>{l}</button></li>
              ))}
            </ul>
            <p className="small">picked: {picked.join(" / ") || "(none)"}</p>
            <div className="row">
              {picked.map((l) => (
                <button key={l} className="btn" onClick={() => { setPicked(picked.filter((x) => x !== l)); setPool([...pool, l]); }}>take back: {l}</button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => {
                setShowRef(true);
                record(orderCorrect ? "correct" : "wrong");
              }}>check</button>
              {showRef && (
                <span className="small mono">
                  {orderCorrect ? "correct" : `correct order: ${algo.lines.join(" → ")}`}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {related.length > 0 && (
        <section>
          <h2>practice this topic</h2>
          <ul className="plain">
            {related.map((r) => (
              <li key={r.key}>
                <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>{" "}
                <span className="mono small muted">{r.difficulty}</span>{" "}
                <button className="btn" onClick={async () => {
                  const n = await db().todoItems.where("problemKey").equals(r.key).count();
                  if (n === 0) {
                    await db().todoItems.add({
                      problemKey: r.key, solved: false, implemented: false, understood: false,
                      solvedWithoutHelp: false, stuck: false, hintLevelUsed: 0, logic: "",
                      acceptedCode: "", keyTrick: "", selfCheck: { observation: false, complexity: false, edgeCases: false },
                      timerSeconds: 0, addedAt: Date.now(),
                    });
                  }
                }}>add to todo</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
