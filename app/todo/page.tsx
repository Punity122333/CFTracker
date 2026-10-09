"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db, getSettings, type TodoItem } from "@/lib/db";
import {
  buildCandidates,
  buildSkillSnapshot,
  loadHiddenKeys,
  rankContextFromSnapshot,
  recordFeedback,
  recordTopicOutcome,
  type SkillSnapshot,
} from "@/lib/skillContext";
import { nextRungs, type Candidate, type RankedCandidate, type RungMode } from "@/lib/recommend";
import { solveQuality, type SolveQualityLevel } from "@/lib/skill";
import { topicsForMistake, checklistFor } from "@/lib/mistakes";
import { setSelection } from "@/lib/selection";
import { parseProblemUrl, problemKey, problemUrlFor } from "@/lib/parseProblemUrl";
import { scheduleReviews, upsolveFirst } from "@/lib/srs";

interface Row extends TodoItem {
  title: string;
  url: string;
  difficulty?: number;
}

const MISTAKE_CATS = ["off-by-one", "overflow", "missed edge case", "wrong greedy", "TLE", "other"];

export default function TodoPage() {
  return (
    <Suspense>
      <TodoInner />
    </Suspense>
  );
}

function TodoInner() {
  const params = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [paste, setPaste] = useState("");
  const [lists, setLists] = useState<{ id?: number; name: string; problemKeys: string[] }[]>([]);
  const [due, setDue] = useState<{ problemKey: string; dueDates: number[] }[]>([]);
  const [stuckTimeout, setStuckTimeout] = useState(45);
  const [filter, setFilter] = useState("");
  const [snap, setSnap] = useState<SkillSnapshot | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showRungs, setShowRungs] = useState(true);
  const [rungs, setRungs] = useState<Record<number, { rows: RankedCandidate[]; line: string; note: string | null }>>({});
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});

  async function reload() {
    const d = db();
    const items = await d.todoItems.toArray();
    const probs = await db().problems.toArray();
    const pm = new Map(probs.map((p) => [p.key, p]));
    setRows(
      items.map((t) => ({
        ...t,
        title: pm.get(t.problemKey)?.title ?? t.problemKey,
        url: pm.get(t.problemKey)?.url ?? "#",
        difficulty: pm.get(t.problemKey)?.difficulty,
      }))
    );
    setLists(await d.lists.toArray());
    const rev = await d.reviews.toArray();
    const now = Date.now();
    setDue(rev.filter((r) => r.dueDates.some((x) => x <= now)));
    const s = await getSettings();
    setStuckTimeout(s.stuckTimeoutMinutes);
    setShowRungs(s.showNextRungs ?? true);
    const [ns, nc, nh] = await Promise.all([buildSkillSnapshot(), buildCandidates(), loadHiddenKeys()]);
    setSnap(ns);
    setCands(nc);
    setHidden(nh);
  }

  async function showNextRungs(row: Row) {
    if (!showRungs || !snap || row.difficulty == null) return;
    const d = db();
    const fb = (await d.feedback.where("problemKey").equals(row.problemKey).toArray())
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const q = solveQuality({
      hintLevelUsed: row.hintLevelUsed,
      solvedWithoutHelp: row.solvedWithoutHelp,
      logicWritten: row.logic.trim().length > 0,
      acceptedCodePresent: row.acceptedCode.trim().length > 0,
      hasSubmission: true,
      override: row.qualityOverride,
    });
    const mode: RungMode =
      fb?.rating === "easy" ? "fast"
      : fb?.rating === "hard" || q.weight < 0.7 ? "same"
      : "climb";
    const topics = topicsForRow(row.problemKey);
    if (topics.length === 0) return;
    const { rungs: rows2, targets, note } = nextRungs(
      rankContextFromSnapshot(snap), cands,
      { topicIds: topics, solvedDifficulty: row.difficulty, mode, hiddenKeys: hidden }
    );
    const theta = snap.thetaByTopic.get(topics[0]) ?? snap.global.theta;
    setRungs({
      ...rungs,
      [row.id!]: {
        rows: rows2,
        line: `${topics[0]} ~${theta}, solved ${row.difficulty} ${q.level}, next ${targets[0]}-${targets[1]}`,
        note,
      },
    });
  }

  function topicsForRow(problemKey: string): string[] {
    const c = cands.find((x) => x.key === problemKey);
    return c?.topicIds ?? [];
  }

  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const add = params.get("add");
    if (add) void addByKey(add).then(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function addByKey(key: string) {
    const d = db();
    const exists = await d.todoItems.where("problemKey").equals(key).count();
    if (exists > 0) return;
    await d.todoItems.add({
      problemKey: key, solved: false, implemented: false, understood: false,
      solvedWithoutHelp: false, stuck: false, hintLevelUsed: 0, logic: "",
      acceptedCode: "", keyTrick: "", selfCheck: { observation: false, complexity: false, edgeCases: false },
      timerSeconds: 0, addedAt: Date.now(),
    });
  }

  async function addPaste() {
    const p = parseProblemUrl(paste);
    if (!p) { alert("could not parse url"); return; }
    const key = problemKey(p.platform, p.id);
    const d = db();
    const has = await d.problems.get(key);
    if (!has) {
      await d.problems.add({
        key, platform: p.platform, pid: p.id, title: key,
        difficulty: undefined, tags: [], url: problemUrlFor(p.platform, p.id), updatedAt: Date.now(),
      });
    }
    await addByKey(key);
    setPaste("");
    await reload();
  }

  async function patch(id: number, p: Partial<TodoItem>) {
    await db().todoItems.update(id, p);
    await reload();
  }

  async function toggleUnderstood(row: Row) {
    const d = db();
    if (!row.understood) {
      const at = Date.now();
      await d.todoItems.update(row.id!, { understood: true, understoodAt: at });
      const prev = await d.reviews.where("problemKey").equals(row.problemKey).first();
      const dueDates = scheduleReviews(at);
      if (prev?.id) await d.reviews.update(prev.id, { dueDates, history: [] });
      else await d.reviews.add({ problemKey: row.problemKey, dueDates, history: [] });
    } else {
      await d.todoItems.update(row.id!, { understood: false });
    }
    await reload();
  }

  async function logMistake(problemKey_: string, category: string) {
    const note = prompt(`note for ${category} (optional)`) ?? "";
    await db().mistakes.add({ problemKey: problemKey_, category, note, timestamp: Date.now() });
    await reload();
  }

  function pickRandom() {
    const pool = rows.filter((r) => !r.solved && !r.done && !r.upsolve);
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    document.getElementById(`todo-${pick.id}`)?.scrollIntoView();
  }

  const shown = rows.filter((r) =>
    !r.done && !r.upsolve &&
    (filter ? (r.title + r.problemKey).toLowerCase().includes(filter.toLowerCase()) : true)
  );
  const revisit = rows.filter((r) => r.stuck && !r.done);
  const upsolveItems = upsolveFirst(
    rows.filter((r) => r.upsolve && !r.done),
    new Set(due.map((d) => d.problemKey))
  );
  const doneItems = rows.filter((r) => r.done);

  return (
    <div>
      <h1>todo</h1>
      <p className="sub">three independent ticks: solved / implemented / understood. press ? for keys.</p>

      <div className="row">
        <input type="text" placeholder="paste problem url (cf / cses / atcoder)" value={paste} onChange={(e) => setPaste(e.target.value)} style={{ maxWidth: 420 }} />
        <button className="btn" onClick={addPaste}>add</button>
        <input type="text" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 160 }} />
        <button className="btn" onClick={pickRandom}>pick random</button>
      </div>

      {snap?.mistake.label && (
        <section>
          <h2>watch out</h2>
          <p className="small">
            {snap.mistake.label} is {Math.round(((snap.mistake.counts[snap.mistake.label] ?? 0) / Math.max(1, Object.values(snap.mistake.counts).reduce((a, b) => a + b, 0))) * 100)}% of your mistakes in the last 60 days
          </p>
          <ul className="plain">
            {checklistFor(snap.mistake.label).map((line) => (
              <li key={line} className="small">
                <label className="row">
                  <input
                    type="checkbox"
                    checked={!!checkedSteps[line]}
                    onChange={() => setCheckedSteps({ ...checkedSteps, [line]: !checkedSteps[line] })}
                  /> {line}
                </label>
              </li>
            ))}
          </ul>
          <p className="small muted">ticks last for this session only. typical topics: {topicsForMistake(snap.mistake.label).join(", ") || "—"}</p>
        </section>
      )}

      {due.length > 0 && (
        <section>
          <h2>due for review ({due.length})</h2>
          <ul className="plain">
            {due.map((r) => (
              <li key={r.problemKey}>
                <span>{r.problemKey}</span>{" "}
                <button className="btn" onClick={async () => {
                  const rev = await db().reviews.where("problemKey").equals(r.problemKey).first();
                  if (rev?.id) {
                    const now = Date.now();
                    const rest = rev.dueDates.filter((x) => x > now);
                    await db().reviews.update(rev.id, { dueDates: rest, history: [...rev.history, now] });
                    await reload();
                  }
                }}>mark reviewed</button>
                <p className="small muted">re-explain the logic from scratch before showing old notes.</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {revisit.length > 0 && (
        <section>
          <h2>revisit ({revisit.length})</h2>
          <ul className="plain">
            {revisit.map((r) => (
              <li key={r.id}><span>{r.title}</span> <span className="muted mono small">{r.problemKey}</span></li>
            ))}
          </ul>
        </section>
      )}

      {upsolveItems.length > 0 && (
        <section>
          <h2>upsolve ({upsolveItems.length})</h2>
          <p className="sub">flagged for upsolve, reviews due first. also listed under contests upsolve.</p>
          <ul className="plain">
            {upsolveItems.map((r) => (
              <li key={r.id} className="small">
                <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>{" "}
                <span className="muted mono">{r.problemKey}</span>{" "}
                {due.some((d) => d.problemKey === r.problemKey) && <span className="muted">review due</span>}{" "}
                <button className="btn" onClick={() => patch(r.id!, { upsolve: false })}>back to items</button>{" "}
                <button className="btn" onClick={() => patch(r.id!, { done: true, doneAt: Date.now(), upsolve: false })}>done</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>items ({shown.length})</h2>
        <ul className="plain">
          {shown.map((r) => (
            <li key={r.id} id={`todo-${r.id}`} className={r.stuck ? "todo-item is-stuck" : "todo-item"}
              onClick={() => setSelection({ problemKey: r.problemKey, topicIds: [], difficulty: r.difficulty, source: "todo" })}>
              <div className="row">
                <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                <span className="muted mono small">{r.problemKey}{r.difficulty ? ` · ${r.difficulty}` : ""}</span>
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <label className="row small"><input type="checkbox" checked={r.solved} onChange={async () => {
                  const v = !r.solved;
                  await patch(r.id!, { solved: v });
                  if (v) {
                    await recordTopicOutcome(r.problemKey, r.solvedWithoutHelp && r.hintLevelUsed === 0);
                    // plan items pointing at this problem are done too
                    const d = db();
                    for (const plan of await d.plans.toArray()) {
                      const items = plan.items.map((it) =>
                        it.ref === r.problemKey && !it.done ? { ...it, done: true, doneAt: Date.now() } : it
                      );
                      if (plan.id) await d.plans.update(plan.id, { items });
                    }
                    await showNextRungs(r);
                  }
                }} /> solved</label>
                <label className="row small"><input type="checkbox" checked={r.implemented} onChange={() => patch(r.id!, { implemented: !r.implemented })} /> implemented</label>
                <label className="row small"><input type="checkbox" checked={r.understood} onChange={() => toggleUnderstood(r)} /> understood</label>
                <label className="row small"><input type="checkbox" checked={r.solvedWithoutHelp} onChange={() => patch(r.id!, { solvedWithoutHelp: !r.solvedWithoutHelp })} /> solved without help</label>
                <button className="btn" onClick={async () => {
                  const v = !r.stuck;
                  await patch(r.id!, { stuck: v });
                  if (v) await recordTopicOutcome(r.problemKey, false);
                }}>{r.stuck ? "unstuck" : "stuck"}</button>
                <button className="btn" onClick={() => patch(r.id!, { upsolve: !r.upsolve, done: false })}>upsolve</button>
                <button className="btn" onClick={() => patch(r.id!, { done: true, doneAt: Date.now(), upsolve: false })}>done</button>
                <span className="small muted mono">{Math.floor(r.timerSeconds / 60)}m {r.timerSeconds % 60}s</span>
                <button className="btn" onClick={() => {
                  const t0 = Date.now();
                  const iv = setInterval(async () => {
                    const cur = await db().todoItems.get(r.id!);
                    if (!cur) { clearInterval(iv); return; }
                    await db().todoItems.update(r.id!, { timerSeconds: cur.timerSeconds + 1 });
                  }, 1000);
                  (window as unknown as { _timers?: Record<number, number> })._timers ??= {};
                  (window as unknown as { _timers: Record<number, number> })._timers[r.id!] = iv as unknown as number;
                  void t0;
                }}>start</button>
                <button className="btn" onClick={() => {
                  const w = (window as unknown as { _timers?: Record<number, number> })._timers;
                  const iv = w?.[r.id!];
                  if (iv) clearInterval(iv);
                  reload();
                }}>pause</button>
              </div>
              <div className="row small" style={{ marginTop: 4 }}>
                <span className="muted">hint level {r.hintLevelUsed}/3:</span>
                {[1, 2, 3].map((lv) => (
                  <button key={lv} className="btn" disabled={r.hintLevelUsed >= lv} onClick={() => patch(r.id!, { hintLevelUsed: lv })}>
                    {lv === 1 ? "tags" : lv === 2 ? "rating" : "editorial"}
                  </button>
                ))}
                {r.hintLevelUsed >= 3 && r.logic.trim().length > 0 && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="small">editorial link (via problem page)</a>
                )}
              </div>
              <div className="row small" style={{ marginTop: 4 }}>
                <span className="muted">rate:</span>
                {(["easy", "right", "hard"] as const).map((f) => (
                  <button key={f} className="btn" onClick={async () => {
                    await recordFeedback({ problemKey: r.problemKey, rating: f, source: "todo", difficulty: r.difficulty });
                    await reload();
                  }}>{f}</button>
                ))}
                {(() => {
                  const q = solveQuality({
                    hintLevelUsed: r.hintLevelUsed,
                    solvedWithoutHelp: r.solvedWithoutHelp,
                    logicWritten: r.logic.trim().length > 0,
                    acceptedCodePresent: r.acceptedCode.trim().length > 0,
                    hasSubmission: false,
                    override: r.qualityOverride,
                  }                  );
                  return (
                    <span className="muted">solve quality: {q.level}{" "}
                      <select
                        value={r.qualityOverride ?? ""}
                        onChange={(e) => patch(r.id!, { qualityOverride: e.target.value || undefined })}
                        style={{ maxWidth: 130 }}
                        aria-label="correct solve quality"
                      >
                        <option value="">auto</option>
                        {(["unaided", "tag hint", "hint 2", "editorial", "assisted"] as SolveQualityLevel[]).map((lv) => (
                          <option key={lv} value={lv}>{lv}</option>
                        ))}
                      </select>
                    </span>
                  );
                })()}
              </div>
              {rungs[r.id!] && (
                <div style={{ marginTop: 6 }}>
                  <p className="small muted">next rungs — {rungs[r.id!].line}</p>
                  {rungs[r.id!].note && <p className="small muted">{rungs[r.id!].note}</p>}
                  <ul className="plain">
                    {rungs[r.id!].rows.map((p) => (
                      <li key={p.key} className="small">
                        <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a>{" "}
                        <span className="mono muted">{p.difficulty}</span>{" "}
                        <button className="btn" onClick={async () => {
                          const d = db();
                          const n = await d.todoItems.where("problemKey").equals(p.key).count();
                          if (n === 0) {
                            await d.todoItems.add({
                              problemKey: p.key, solved: false, implemented: false, understood: false,
                              solvedWithoutHelp: false, stuck: false, hintLevelUsed: 0, logic: "",
                              acceptedCode: "", keyTrick: "", selfCheck: { observation: false, complexity: false, edgeCases: false },
                              timerSeconds: 0, addedAt: Date.now(),
                            });
                            await reload();
                          }
                        }}>add to todo</button>{" "}
                        {(["easy", "right", "hard"] as const).map((f) => (
                          <button key={f} className="btn" onClick={() => recordFeedback({ problemKey: p.key, rating: f, source: "nextRung", difficulty: p.difficulty, topicIds: p.topicIds })}>{f}</button>
                        ))}{" "}
                        <button className="btn" onClick={async () => {
                          await db().hiddenProblems.add({ problemKey: p.key, reason: "notInterested", timestamp: Date.now() });
                        }}>hide</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <details style={{ marginTop: 4 }}>
                <summary className="small">logic — write the solution</summary>
                <textarea
                  rows={5}
                  placeholder={"key observation:\n...\nalgorithm:\n...\ncomplexity:\n...\nedge cases:\n..."}
                  defaultValue={r.logic}
                  onBlur={(e) => patch(r.id!, { logic: e.target.value })}
                />
                <input type="text" placeholder="key trick (one line)" defaultValue={r.keyTrick} onBlur={(e) => patch(r.id!, { keyTrick: e.target.value })} style={{ marginTop: 4 }} />
                <textarea rows={3} placeholder="accepted code (paste)" defaultValue={r.acceptedCode} onBlur={(e) => patch(r.id!, { acceptedCode: e.target.value })} className="mono" style={{ marginTop: 4 }} />
                <div className="row small" style={{ marginTop: 4 }}>
                  <label className="row"><input type="checkbox" checked={r.selfCheck.observation} onChange={() => patch(r.id!, { selfCheck: { ...r.selfCheck, observation: !r.selfCheck.observation } })} /> stated the key observation</label>
                  <label className="row"><input type="checkbox" checked={r.selfCheck.complexity} onChange={() => patch(r.id!, { selfCheck: { ...r.selfCheck, complexity: !r.selfCheck.complexity } })} /> stated complexity</label>
                  <label className="row"><input type="checkbox" checked={r.selfCheck.edgeCases} onChange={() => patch(r.id!, { selfCheck: { ...r.selfCheck, edgeCases: !r.selfCheck.edgeCases } })} /> covered edge cases</label>
                </div>
                <div className="row small" style={{ marginTop: 4 }}>
                  <span className="muted">mistake:</span>
                  {MISTAKE_CATS.map((c) => (
                    <button key={c} className="btn" onClick={() => logMistake(r.problemKey, c)}>{c}</button>
                  ))}
                </div>
              </details>
              <p className="small muted">auto-prompt stuck after {stuckTimeout} min (setting).</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>lists</h2>
        <div className="row">
          <button className="btn" onClick={async () => {
            const name = prompt("list name") ?? "";
            if (!name) return;
            await db().lists.add({ name, problemKeys: [] });
            await reload();
          }}>new list</button>
        </div>
        <ul className="plain">
          {lists.map((l) => (
            <li key={l.id}>
              <span>{l.name}</span> <span className="muted mono small">{l.problemKeys.length} problems</span>
            </li>
          ))}
        </ul>
      </section>

      {doneItems.length > 0 && (
        <section>
          <h2>done ({doneItems.length})</h2>
          <p className="sub">finished problems, out of the way. reopen to work on one again.</p>
          <ul className="plain">
            {doneItems.map((r) => (
              <li key={r.id} className="small">
                <span>{r.title}</span>{" "}
                <span className="muted mono">{r.problemKey}</span>{" "}
                {r.doneAt && <span className="muted">done {new Date(r.doneAt).toLocaleDateString()}</span>}{" "}
                <button className="btn" onClick={() => patch(r.id!, { done: false, doneAt: undefined })}>reopen</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
