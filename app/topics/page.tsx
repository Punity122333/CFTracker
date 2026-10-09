"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { buildCandidates, buildSkillSnapshot, loadHiddenKeys, rankContextFromSnapshot, type SkillSnapshot } from "@/lib/skillContext";
import { rankCandidates, type Candidate, type RankedCandidate } from "@/lib/recommend";
import { rankStudyNext, type TopicDef } from "@/lib/topics";

const GROUPS = ["foundations", "math", "graphs", "trees", "dp", "data structures", "strings", "geometry", "other"];

async function addToTodo(problemKey: string) {
  const d = db();
  const n = await d.todoItems.where("problemKey").equals(problemKey).count();
  if (n === 0) {
    await d.todoItems.add({
      problemKey, solved: false, implemented: false, understood: false,
      solvedWithoutHelp: false, stuck: false, hintLevelUsed: 0, logic: "",
      acceptedCode: "", keyTrick: "", selfCheck: { observation: false, complexity: false, edgeCases: false },
      timerSeconds: 0, addedAt: Date.now(),
    });
  }
}

// Gentle ladder from a ranked list: one easier, mostly on target, one above.
function ladder(ranked: RankedCandidate[], n = 5): RankedCandidate[] {
  if (ranked.length <= n) return ranked;
  const byDiff = [...ranked].sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0));
  const picks: RankedCandidate[] = [byDiff[0]];
  const mid = byDiff.slice(1, -1);
  const step = Math.max(1, Math.floor(mid.length / (n - 2)));
  for (let i = 0; i < mid.length && picks.length < n - 1; i += step) picks.push(mid[i]);
  picks.push(byDiff[byDiff.length - 1]);
  return picks.slice(0, n);
}

export default function TopicsPage() {
  const [snap, setSnap] = useState<SkillSnapshot | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const [s, c, h] = await Promise.all([buildSkillSnapshot(), buildCandidates(), loadHiddenKeys()]);
      setSnap(s);
      setCands(c);
      setHidden(h);
      const ts = await db().topicState.toArray();
      const nm: Record<string, string> = {};
      for (const r of ts) nm[r.topicId] = r.note;
      setNotes(nm);
    })();
  }, []);

  const ctx = useMemo(() => (snap ? rankContextFromSnapshot(snap) : null), [snap]);

  const studyNext = useMemo(() => {
    if (!snap) return [];
    const statusById = new Map([...snap.perTopic].map(([id, s]) => [id, s.status]));
    const solvedById = new Map([...snap.perTopic].map(([id, s]) => [id, s.solved]));
    const weightedById = new Map([...snap.perTopic].map(([id, s]) => [id, s.weightedSolved]));
    return rankStudyNext({
      topics: snap.topics, statusById, solvedById, weightedById,
      thetaByTopic: snap.thetaByTopic, globalTheta: snap.global.theta,
    });
  }, [snap]);

  const studyReason = useMemo(() => new Map(studyNext.map((c) => [c.topic.id, c.reason])), [studyNext]);

  const practiceFor = useMemo(() => {
    if (!ctx) return new Map<string, RankedCandidate[]>();
    const m = new Map<string, RankedCandidate[]>();
    if (!expanded) return m;
    const { ranked } = rankCandidates(ctx, cands, { onlyTopics: new Set([expanded]), limit: 12, hiddenKeys: hidden });
    m.set(expanded, ladder(ranked));
    return m;
  }, [ctx, cands, expanded, hidden]);

  async function saveTopicState(id: string, patch: { statusOverride?: string; skipped?: boolean; note?: string }) {
    const d = db();
    const prev = await d.topicState.where("topicId").equals(id).first();
    const cur = {
      statusOverride: prev?.statusOverride,
      skipped: prev?.skipped ?? false,
      note: prev?.note ?? "",
    };
    const next = {
      statusOverride: patch.statusOverride ?? cur.statusOverride,
      skipped: patch.skipped ?? cur.skipped,
      note: patch.note ?? cur.note,
    };
    if (prev?.id) await d.topicState.update(prev.id, { topicId: id, ...next, userResources: prev.userResources ?? [] });
    else await d.topicState.add({ topicId: id, ...next, userResources: [] });
    const [s] = await Promise.all([buildSkillSnapshot()]);
    setSnap(s);
  }

  const topics: TopicDef[] = snap?.topics ?? [];

  return (
    <div>
      <h1>topics</h1>
      <p className="sub">
        atcoder problems count toward a topic only via manual tags (no upstream tags).
        {snap && <> your level ~{snap.global.theta} · <a href="/skill">skill debug</a></>}
      </p>

      <section>
        <h2>study next</h2>
        <ul className="plain">
          {studyNext.map((c) => (
            <li key={c.topic.id}>
              <a href={`#topic-${c.topic.id}`}>{c.topic.name}</a>{" "}
              <span className="muted small">{c.topic.id} · {c.status} · {c.reason}</span>
            </li>
          ))}
          {studyNext.length === 0 && <li className="muted">nothing eligible — check prerequisites</li>}
        </ul>
      </section>

      <div className="row small" style={{ marginTop: 8 }}>
        <label className="row"><input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} /> show skipped</label>
      </div>

      {GROUPS.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <table className="plain">
            <thead><tr><th>topic</th><th>status</th><th>ability</th><th>solved</th><th>why</th></tr></thead>
            <tbody>
              {topics.filter((t) => t.group === g).map((t) => {
                const s = snap?.perTopic.get(t.id);
                const eff = s?.status ?? "not started";
                if (eff === "skipped" && !showSkipped) return null;
                const ability = s ? snap!.thetaByTopic.get(t.id) : undefined;
                return (
                  <>
                    <tr key={t.id} id={`topic-${t.id}`}>
                      <td>
                        <button className="btn" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>{t.name}</button>
                        <div className="muted small mono">{t.id} · {t.ratingRange[0]}-{t.ratingRange[1]}</div>
                        {t.codeforcesTags.length === 0 && (
                          <div className="muted small">few auto-tags, tag problems manually</div>
                        )}
                      </td>
                      <td className="small">{eff}</td>
                      <td className="mono">{ability != null ? `~${ability}` : "—"}</td>
                      <td className="mono">{s?.solved ?? 0}</td>
                      <td className="small muted">{studyReason.get(t.id) ?? `${s?.solved ?? 0} solved, prereqs: ${t.prerequisites.join(", ") || "none"}`}</td>
                    </tr>
                    {expanded === t.id && (
                      <tr key={`${t.id}-x`}>
                        <td colSpan={5}>
                          <p className="small">{t.description}</p>
                          <p className="small">
                            {t.resources.map((x) => (
                              <span key={x.url} style={{ marginRight: 12 }}><a href={x.url} target="_blank" rel="noreferrer">{x.label}</a></span>
                            ))}
                            {t.codeforcesTags.map((x) => (
                              <span key={x} style={{ marginRight: 12 }}><a href={`https://codeforces.com/problemset?tags=${encodeURIComponent(x)}`} target="_blank" rel="noreferrer">cf:{x}</a></span>
                            ))}
                            <a href="https://cses.fi/problemset/" target="_blank" rel="noreferrer">cses</a>
                          </p>
                          <p className="small muted">practice set (ladder at your level for this topic):</p>
                          <ul className="plain">
                            {(practiceFor.get(t.id) ?? []).map((p) => (
                              <li key={p.key}>
                                <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a>{" "}
                                <span className="mono small muted">{p.difficulty ?? "-"}</span>{" "}
                                <button className="btn" onClick={() => addToTodo(p.key)}>add to todo</button>
                                <div className="small muted">{p.reason}</div>
                              </li>
                            ))}
                            {(practiceFor.get(t.id) ?? []).length === 0 && (
                              <li className="muted small">few problems left in your window, raise your level or widen the filter.</li>
                            )}
                          </ul>
                          <div className="row small">
                            <button className="btn" onClick={() => saveTopicState(t.id, { statusOverride: "learned" })}>mark learned</button>
                            <button className="btn" onClick={() => saveTopicState(t.id, { statusOverride: "" })}>clear override</button>
                            <button className="btn" onClick={() => saveTopicState(t.id, { skipped: eff !== "skipped" })}>{eff === "skipped" ? "unskip" : "skip"}</button>
                          </div>
                          <textarea
                            rows={2}
                            placeholder="study note (autosaves on blur)"
                            defaultValue={notes[t.id] ?? ""}
                            key={`note-${t.id}-${notes[t.id]?.length ?? 0}`}
                            onBlur={(e) => {
                              setNotes({ ...notes, [t.id]: e.target.value });
                              saveTopicState(t.id, { note: e.target.value });
                            }}
                            style={{ marginTop: 6 }}
                          />
                          <div className="row small" style={{ marginTop: 6 }}>
                            <button className="btn" onClick={async () => {
                              const tag = prompt("manual tag (= topic id, e.g. dpbasics)") ?? "";
                              if (!tag) return;
                              const key = prompt("problem key (e.g. atcoder:abc:xyz)") ?? "";
                              if (!key) return;
                              const d = db();
                              const prev = await d.manualTags.where("problemKey").equals(key).first();
                              if (prev?.id) await d.manualTags.update(prev.id, { tags: [...prev.tags, tag] });
                              else await d.manualTags.add({ problemKey: key, tags: [tag] });
                              const [ns] = await Promise.all([buildSkillSnapshot()]);
                              setSnap(ns);
                            }}>add manual tag</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
