"use client";

import { useEffect, useMemo, useState } from "react";
import { db, getSettings, saveSettings } from "@/lib/db";
import { backfillAbility, buildCandidates, buildSkillSnapshot, loadHiddenKeys, maybeSnapshot, rankContextFromSnapshot, weeklyDeltas, type SkillSnapshot, type SnapshotPoint } from "@/lib/skillContext";
import { rankCandidates, type Candidate } from "@/lib/recommend";
import { absoluteCeiling } from "@/lib/skill";

export default function SkillPage() {
  const [snap, setSnap] = useState<SkillSnapshot | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [comfort, setComfort] = useState("");
  const [msg, setMsg] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [points, setPoints] = useState<SnapshotPoint[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [backfillMsg, setBackfillMsg] = useState("");

  async function reload() {
    const [s, c, h] = await Promise.all([buildSkillSnapshot(), buildCandidates(), loadHiddenKeys()]);
    setSnap(s);
    setCands(c);
    setHidden(h);
    await maybeSnapshot(s);
    const rows = await db().abilitySnapshots.orderBy("date").toArray();
    const pts = rows.map((r) => ({ date: r.date, globalTheta: r.globalTheta, topicThetas: r.topicThetas }));
    setPoints(pts);
    // auto-backfill once: empty history with synced submissions
    if (pts.length === 0) {
      const nsubs = await db().submissions.count();
      if (nsubs > 0) {
        setBackfillMsg("rebuilding past ability, this takes a moment…");
        await backfillAbility();
        const rows2 = await db().abilitySnapshots.orderBy("date").toArray();
        setPoints(rows2.map((r) => ({ date: r.date, globalTheta: r.globalTheta, topicThetas: r.topicThetas })));
        setBackfillMsg("");
      }
    }
    const st = await getSettings();
    setComfort(st.comfortRating ? String(st.comfortRating) : "");
  }

  useEffect(() => { reload(); }, []);

  const ctx = useMemo(() => (snap ? rankContextFromSnapshot(snap) : null), [snap]);

  const top10 = useMemo(() => {
    if (!ctx) return [];
    return rankCandidates(ctx, cands, { limit: 10, hiddenKeys: hidden }).ranked;
  }, [ctx, cands, hidden]);

  const rows = useMemo(() => {
    if (!snap) return [];
    return snap.topics.map((t) => ({ topic: t, snap: snap.perTopic.get(t.id)! }));
  }, [snap]);

  async function saveComfort() {
    const v = comfort.trim() === "" ? undefined : Number(comfort);
    if (v !== undefined && (!Number.isFinite(v) || v <= 0)) { setMsg("enter a positive rating or empty"); return; }
    await saveSettings({ comfortRating: v });
    setMsg("saved — recomputing");
    await reload();
  }

  async function saveTopicOverride(topicId: string, value: string) {
    const d = db();
    const v = value.trim() === "" ? undefined : Number(value);
    if (v !== undefined && (!Number.isFinite(v) || v <= 0)) { setMsg("override must be positive or empty"); return; }
    const prev = await d.topicState.where("topicId").equals(topicId).first();
    if (prev?.id) await d.topicState.update(prev.id, { comfortRating: v });
    else await d.topicState.add({ topicId, skipped: false, note: "", userResources: [], comfortRating: v });
    await reload();
  }

  return (
    <div>
      <h1>skill</h1>
      <p className="sub">debug view for the adaptive model. ability is tracked per topic, not just globally.</p>

      <section>
        <h2>global estimate</h2>
        <div className="row">
          <label className="small">my comfortable level (problems I can solve)
            <input type="number" value={comfort} onChange={(e) => setComfort(e.target.value)} style={{ maxWidth: 120 }} placeholder="empty = estimate" />
          </label>
          <button className="btn" onClick={saveComfort}>save</button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
        <p className="small muted">a set level overrides the estimate.</p>
        {snap && (
          <table className="plain">
            <thead><tr><th>source</th><th>value</th></tr></thead>
            <tbody>
              <tr><td>contest rating from sync</td><td className="mono">{snap.global.contestRating ?? "—"}</td></tr>
              <tr><td>solve-based estimate</td><td className="mono">{snap.global.solveEstimate ?? "—"}</td></tr>
              <tr><td>final global θ ({snap.global.source})</td><td className="mono">{snap.global.theta}</td></tr>
              <tr><td>hard ceiling (global + 500 + 200)</td><td className="mono">{absoluteCeiling(snap.global.theta)}</td></tr>
            </tbody>
          </table>
        )}
        {snap?.coldStart && <p className="small">no data yet — set your comfortable level above.</p>}
      </section>

      <section>
        <h2>estimator inputs</h2>
        {snap && (
          <table className="plain">
            <thead><tr><th>input</th><th>value</th></tr></thead>
            <tbody>
              <tr><td>handle set</td><td className="mono">{snap.estimator.handleSet ? `yes (${snap.estimator.cfHandle})` : "no"}</td></tr>
              <tr><td>last sync</td><td className="mono">{snap.estimator.lastSyncAt ? new Date(snap.estimator.lastSyncAt).toLocaleString() : "never"}</td></tr>
              <tr><td>stored submissions</td><td className="mono">{snap.estimator.submissionsTotal}</td></tr>
              <tr><td>accepted submissions</td><td className="mono">{snap.estimator.acceptedTotal}</td></tr>
              <tr><td>accepted problems (first accepted each)</td><td className="mono">{snap.estimator.acceptedProblems}</td></tr>
              <tr><td>accepted with a difficulty</td><td className="mono">{snap.estimator.withDifficulty}</td></tr>
              <tr><td>in chosen window ({snap.estimator.windowLabel}, min {snap.estimator.minSolves})</td><td className="mono">{snap.estimator.inWindow}</td></tr>
              <tr><td>contest rating found</td><td className="mono">{snap.estimator.contestRating ?? "none"}</td></tr>
              <tr><td>branch</td><td className="mono">{snap.estimator.branch}</td></tr>
              <tr><td>final θ</td><td className="mono">{snap.estimator.guess}</td></tr>
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>per topic</h2>
        <table className="plain">
          <thead><tr><th>topic</th><th>ability</th><th>conf</th><th>solves</th><th>failures</th><th>target</th><th>feedback (e/r/h)</th><th>override</th></tr></thead>
          <tbody>
            {rows.map(({ topic, snap: s }) => (
              <tr key={topic.id}>
                <td>{topic.id}</td>
                <td className="mono">~{s.ability.theta}{s.ability.overridden ? " (manual)" : ""}</td>
                <td className="mono">{Math.round(s.ability.confidence * 100)}%</td>
                <td className="mono">{s.ability.solves}</td>
                <td className="mono">{s.ability.failures}</td>
                <td className="mono">{s.target[0]}-{s.target[1]}</td>
                <td className="mono small">{s.feedback.easy}/{s.feedback.right}/{s.feedback.hard}</td>
                <td>
                  <input
                    type="number"
                    key={`${topic.id}-${s.ability.overridden}`}
                    defaultValue={s.ability.overridden ? s.ability.theta : ""}
                    placeholder="—"
                    style={{ maxWidth: 80 }}
                    onBlur={(e) => saveTopicOverride(topic.id, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>in-contest evidence</h2>
        {snap && (
          <table className="plain">
            <thead><tr><th>measure</th><th>value</th></tr></thead>
            <tbody>
              <tr><td>contests considered</td><td className="mono">{snap.contestEvidence.contests}</td></tr>
              <tr><td>in-contest solves</td><td className="mono">{snap.contestEvidence.inContestSolves}</td></tr>
              <tr><td>in-contest failures</td><td className="mono">{snap.contestEvidence.inContestFailures}</td></tr>
              <tr><td>upsolves</td><td className="mono">{snap.contestEvidence.upsolves}</td></tr>
              <tr><td>topics most affected</td><td className="small mono">{snap.contestEvidence.topics.map((t) => `${t.id} ${t.count}`).join(", ") || "—"}</td></tr>
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>mistakes (last 60 days)</h2>
        {snap && Object.keys(snap.mistake.counts).length > 0 ? (
          <table className="plain">
            <tbody>
              {Object.entries(snap.mistake.counts).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                <tr key={cat}><td>{cat}</td><td className="mono">{n}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small muted">none logged.</p>
        )}
      </section>

      <section>
        <h2>ability history</h2>
        {points.length < 2 ? (
          <p className="small muted">not enough history yet.</p>
        ) : (
          <TopicChart
            points={points}
            current={snap?.thetaByTopic ?? new Map()}
            picked={picked}
            setPicked={setPicked}
          />
        )}
        {backfillMsg && <p className="small muted">{backfillMsg}</p>}
        {snap && points.length >= 2 && (
          <table className="plain" style={{ marginTop: 8 }}>
            <thead><tr><th>topic</th><th>now</th><th>4w change</th></tr></thead>
            <tbody>
              {weeklyDeltas(points, snap.thetaByTopic)
                .filter((d) => d.delta !== 0)
                .sort((a, b) => b.delta - a.delta)
                .slice(0, 12)
                .map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}</td>
                    <td className="mono">~{d.now}</td>
                    <td className="mono">{d.delta > 0 ? `+${d.delta}` : d.delta}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>top 10 ranked right now</h2>
        <table className="plain">
          <thead><tr><th>problem</th><th>diff</th><th>topics</th><th>eff ability</th><th>score</th></tr></thead>
          <tbody>
            {top10.map((r) => (
              <tr key={r.key}>
                <td><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></td>
                <td className="mono">{r.difficulty}</td>
                <td className="small muted">{r.topicIds.join(", ") || "—"}</td>
                <td className="mono">~{r.thetaProblem}</td>
                <td className="mono">{r.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const LINE_COLORS = [
  "var(--accent)", "var(--good)", "var(--warn)",
  "var(--fg)", "var(--muted)", "#b07cc6",
];

function TopicChart({ points, current, picked, setPicked }: {
  points: SnapshotPoint[];
  current: Map<string, number>;
  picked: string[];
  setPicked: (ids: string[]) => void;
}) {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const ids = [...current.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const defaults = [...ids.slice(0, 3), ...ids.slice(-3)].filter((id, i, arr) => arr.indexOf(id) === i);
  const active = (picked.length > 0 ? picked : defaults).slice(0, 6);
  const allVals = sorted.flatMap((p) => active.map((id) => p.topicThetas[id] ?? 0));
  const mn = Math.min(...allVals);
  const mx = Math.max(...allVals);
  const span = Math.max(1, mx - mn);
  const X = (i: number) => 8 + (i / Math.max(1, sorted.length - 1)) * 560;
  const Y = (v: number) => 66 - ((v - mn) / span) * 52;
  return (
    <div>
      <div className="row small" style={{ marginBottom: 6 }}>
        {ids.slice(0, 24).map((id) => (
          <label key={id} className="row">
            <input
              type="checkbox"
              checked={active.includes(id)}
              onChange={() => {
                const base = picked.length > 0 ? picked : defaults;
                setPicked(base.includes(id) ? base.filter((x) => x !== id) : [...base, id].slice(0, 6));
              }}
            /> {id}
          </label>
        ))}
      </div>
      <svg width="100%" height="110" viewBox="0 0 700 110" role="img" aria-label="per-topic ability history" style={{ display: "block" }}>
        <line x1="8" y1="80" x2="692" y2="80" stroke="var(--hairline)" strokeWidth="1" />
        {active.map((id, k) => {
          const pts = sorted.map((p, i) => `${X(i)},${Y(p.topicThetas[id] ?? mn)}`).join(" ");
          const lastV = sorted[sorted.length - 1].topicThetas[id] ?? mn;
          return (
            <g key={id}>
              <polyline fill="none" stroke={LINE_COLORS[k % LINE_COLORS.length]} strokeWidth="1.5" points={pts} />
              <text x={692} y={Y(lastV) + 3} fontSize="10" textAnchor="end" fill={LINE_COLORS[k % LINE_COLORS.length]}>
                {id} {current.get(id) ?? lastV}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
