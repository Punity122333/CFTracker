"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { mistakeStats } from "@/lib/mistakes";

export default function NotesPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ where: string; key: string; text: string }[]>([]);
  const [snippets, setSnippets] = useState<{ id?: number; title: string; tags: string[]; code: string }[]>([]);
  const [summary, setSummary] = useState({ solved: 0, reviewed: 0, overdue: 0, stuck: 0 });
  const [mistakeCounts, setMistakeCounts] = useState<Record<string, number>>({});
  const [planDone, setPlanDone] = useState("");

  useEffect(() => { reload(); }, []);

  async function reload() {
    const d = db();
    setSnippets(await d.snippets.toArray());
    const week = Date.now() - 7 * 86400000;
    const subs = await d.submissions.toArray();
    const solved = new Set(subs.filter((s) => s.verdict === "OK" && s.timestamp >= week).map((s) => s.problemKey)).size;
    const rev = await d.reviews.toArray();
    const now = Date.now();
    const reviewed = rev.filter((r) => r.history.some((h) => h >= week)).length;
    const overdue = rev.filter((r) => r.dueDates.some((x) => x <= now)).length;
    const stuck = await d.todoItems.where("stuck").equals(1).count().catch(() => 0);
    setSummary({ solved, reviewed, overdue, stuck });
    const ms = mistakeStats(
      (await d.mistakes.toArray()).map((m) => ({ category: m.category, timestamp: m.timestamp })),
      Date.now()
    );
    setMistakeCounts(ms.counts);
    // current-week plan completion
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);
    const plan = await d.plans.where("weekStart").equals(weekStart).first();
    if (plan) {
      const done = plan.items.filter((it) => it.done).length;
      setPlanDone(`${done} of ${plan.items.length} plan items done`);
    } else {
      setPlanDone("");
    }
  }

  async function search() {
    const d = db();
    const out: { where: string; key: string; text: string }[] = [];
    const needle = q.toLowerCase();
    if (!needle) { setResults([]); return; }
    for (const t of await d.todoItems.toArray()) {
      if (t.logic.toLowerCase().includes(needle)) out.push({ where: "logic", key: t.problemKey, text: t.logic.slice(0, 120) });
      if (t.keyTrick.toLowerCase().includes(needle)) out.push({ where: "key trick", key: t.problemKey, text: t.keyTrick });
    }
    for (const m of await d.mistakes.toArray()) {
      if ((m.note + m.category).toLowerCase().includes(needle)) out.push({ where: "mistake", key: m.problemKey, text: `${m.category}: ${m.note}` });
    }
    for (const t of await d.topicState.toArray()) {
      if (t.note.toLowerCase().includes(needle)) out.push({ where: "topic note", key: t.topicId, text: t.note.slice(0, 120) });
    }
    setResults(out.slice(0, 50));
  }

  return (
    <div>
      <h1>notes</h1>
      <p className="sub">global search, snippet vault, weekly summary.</p>

      <section>
        <h2>search</h2>
        <div className="row">
          <input type="text" placeholder="search logic, tricks, mistakes, topic notes" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} style={{ maxWidth: 400 }} />
          <button className="btn" onClick={search}>search</button>
        </div>
        <ul className="plain">
          {results.map((r, i) => (
            <li key={i}><span className="muted small">{r.where}</span> <span className="mono small">{r.key}</span><p className="small">{r.text}</p></li>
          ))}
        </ul>
      </section>

      <section>
        <h2>snippet vault</h2>
        <div className="row">
          <button className="btn" onClick={async () => {
            const title = prompt("title, e.g. modpow") ?? "";
            if (!title) return;
            const code = prompt("code") ?? "";
            await db().snippets.add({ title, tags: [], code });
            await reload();
          }}>new snippet</button>
        </div>
        <ul className="plain">
          {snippets.map((s) => (
            <li key={s.id}>
              <span>{s.title}</span> <span className="muted small mono">{(s.tags ?? []).join(", ")}</span>
              <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>{s.code}</pre>
              <div className="row">
                <button className="btn" onClick={() => navigator.clipboard?.writeText(s.code)}>copy</button>
                <button className="btn" onClick={async () => { if (s.id) { await db().snippets.delete(s.id); await reload(); } }}>delete</button>
              </div>
            </li>
          ))}
          {snippets.length === 0 && <li className="muted">no snippets yet</li>}
        </ul>
      </section>

      <section>
        <h2>weekly summary (past 7 days)</h2>
        <table className="plain">
          <tbody>
            <tr><td>solved</td><td className="mono">{summary.solved}</td></tr>
            <tr><td>reviewed</td><td className="mono">{summary.reviewed}</td></tr>
            <tr><td>overdue now</td><td className="mono">{summary.overdue}</td></tr>
            <tr><td>marked stuck</td><td className="mono">{summary.stuck}</td></tr>
            {planDone && <tr><td>plan</td><td className="mono">{planDone}</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2>mistakes (last 60 days)</h2>
        <table className="plain">
          <tbody>
            {Object.entries(mistakeCounts).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
              <tr key={cat}><td>{cat}</td><td className="mono">{n}</td></tr>
            ))}
            {Object.keys(mistakeCounts).length === 0 && <tr><td className="muted">none logged.</td><td /></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
