"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import {
  buildCandidates,
  buildSkillSnapshot,
  levelLine,
  loadHiddenKeys,
  rankContextFromSnapshot,
  recordFeedback,
  type SkillSnapshot,
} from "@/lib/skillContext";
import {
  rankCandidates,
  surprisePick,
  type Candidate,
  type RankedCandidate,
} from "@/lib/recommend";
import { absoluteCeiling } from "@/lib/skill";
import { setSelection, type Selection } from "@/lib/selection";

async function giveFeedback(
  r: RankedCandidate,
  rating: "easy" | "right" | "hard",
  reload: () => void
) {
  await recordFeedback({
    problemKey: r.key, rating, source: "recommendation",
    difficulty: r.difficulty, topicIds: r.topicIds,
  });
  await reload();
}

async function hideProblem(r: RankedCandidate, reason: "notInterested" | "tooHard" | "broken" | "other", reload: () => void) {
  const d = db();
  const prev = await d.hiddenProblems.where("problemKey").equals(r.key).first();
  if (!prev) {
    await d.hiddenProblems.add({ problemKey: r.key, reason, timestamp: Date.now() });
  }
  if (reason === "tooHard") {
    await recordFeedback({
      problemKey: r.key, rating: "hard", source: "recommendation",
      difficulty: r.difficulty, topicIds: r.topicIds,
    });
  }
  await reload();
}

export default function Recommendations() {
  const [snap, setSnap] = useState<SkillSnapshot | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState("");
  const [tag, setTag] = useState("");
  const [includeUnrated, setIncludeUnrated] = useState(false);
  const [surprise, setSurprise] = useState<RankedCandidate | null>(null);

  async function reload() {
    const [s, c, h] = await Promise.all([buildSkillSnapshot(), buildCandidates(), loadHiddenKeys()]);
    setSnap(s);
    setCands(c);
    setHidden(h);
  }

  useEffect(() => { reload(); }, []);

  const ctx = useMemo(() => (snap ? rankContextFromSnapshot(snap) : null), [snap]);

  const { ranked, scarce } = useMemo(() => {
    if (!ctx || !snap) return { ranked: [] as RankedCandidate[], scarce: false };
    const filtered = cands.filter(
      (c) =>
        (!platform || c.platform === platform) &&
        (!tag || c.tags.includes(tag) || c.topicIds.includes(tag))
    );
    const { ranked, report } = rankCandidates(ctx, filtered, { includeUnrated, limit: 50, hiddenKeys: hidden });
    return { ranked, scarce: report.kept === 0 && filtered.length > 0 };
  }, [ctx, snap, cands, platform, tag, includeUnrated, hidden]);

  const ceiling = snap ? absoluteCeiling(snap.global.theta) : 0;

  const select = (r: RankedCandidate) => {
    const s: Selection = {
      problemKey: r.key, topicIds: r.topicIds,
      difficulty: r.difficulty, source: "recommendation",
    };
    setSelection(s);
  };

  return (
    <div>
      <h1>recommendations</h1>
      <p className="sub">
        ranked by per-topic ability, never above your ceiling ({ceiling}).
      </p>
      {snap && <p className="sub">{levelLine(snap)}</p>}
      <div className="row">
        <label className="small">platform
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">all</option>
            <option value="codeforces">codeforces</option>
            <option value="cses">cses</option>
            <option value="atcoder">atcoder</option>
          </select>
        </label>
        <label className="small">tag/topic <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} style={{ maxWidth: 120 }} /></label>
        <label className="row small"><input type="checkbox" checked={includeUnrated} onChange={(e) => setIncludeUnrated(e.target.checked)} /> include unrated</label>
        <button className="btn" onClick={() => setSurprise(surprisePick(String(Date.now()), ranked))}>surprise me</button>
      </div>
      {surprise && (
        <div className="spotlight" style={{ marginTop: 10 }}>
          <a href={surprise.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{surprise.title}</a>{" "}
          <span className="muted mono small">{surprise.key} · {surprise.difficulty}</span>
          <p className="small muted" style={{ margin: "2px 0 0" }}>{surprise.reason}</p>
        </div>
      )}
      {scarce && (
        <p className="small">few problems left in your window, raise your level or widen the filter.</p>
      )}
      <table className="plain" style={{ marginTop: 12 }}>
        <thead><tr><th>problem</th><th>diff</th><th>why</th><th>rate</th><th></th></tr></thead>
        <tbody>
          {ranked.map((r) => (
            <tr key={r.key} onClick={() => select(r)} tabIndex={0}>
              <td><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> <span className="muted small mono">{r.key}</span></td>
              <td className="mono">{r.difficulty ?? "-"}</td>
              <td className="small muted">{r.reason}</td>
              <td className="small">
                <button className="btn" onClick={() => giveFeedback(r, "easy", reload)}>easy</button>{" "}
                <button className="btn" onClick={() => giveFeedback(r, "right", reload)}>right</button>{" "}
                <button className="btn" onClick={() => giveFeedback(r, "hard", reload)}>hard</button>
              </td>
              <td>
                <button className="btn" onClick={async () => {
                  const d = db();
                  const n = await d.todoItems.where("problemKey").equals(r.key).count();
                  if (n === 0) {
                    await d.todoItems.add({
                      problemKey: r.key, solved: false, implemented: false, understood: false,
                      solvedWithoutHelp: false, stuck: false, hintLevelUsed: 0, logic: "",
                      acceptedCode: "", keyTrick: "", selfCheck: { observation: false, complexity: false, edgeCases: false },
                      timerSeconds: 0, addedAt: Date.now(),
                    });
                  }
                }}>add to todo</button>{" "}
                <button className="btn" onClick={() => hideProblem(r, "notInterested", reload)}>hide</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length === 0 && !scarce && <p className="small muted">sync a handle or add problems first.</p>}
    </div>
  );
}
