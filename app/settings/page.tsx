"use client";

import { useEffect, useState } from "react";
import { db, getSettings, saveSettings } from "@/lib/db";
import { exportAll, importAll } from "@/lib/exportImport";

export default function SettingsPage() {
  const [s, setS] = useState({ cfHandle: "", atcoderHandle: "", csesUser: "", difficultyLow: 0, difficultyHigh: 300, weeklyGoal: 5, stuckTimeoutMinutes: 45, lastExportAt: 0, comfortRating: "", showNextRungs: true, warmupMinutes: 30 });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getSettings().then((x) => setS({
      cfHandle: x.cfHandle, atcoderHandle: x.atcoderHandle, csesUser: x.csesUser ?? "",
      difficultyLow: x.difficultyLow, difficultyHigh: x.difficultyHigh,
      weeklyGoal: x.weeklyGoal, stuckTimeoutMinutes: x.stuckTimeoutMinutes,
      lastExportAt: x.lastExportAt ?? 0,
      comfortRating: x.comfortRating ? String(x.comfortRating) : "",
      showNextRungs: x.showNextRungs ?? true,
      warmupMinutes: x.warmupMinutes ?? 30,
    }));
  }, []);

  async function save() {
    const v = s.comfortRating.trim() === "" ? undefined : Number(s.comfortRating);
    if (v !== undefined && (!Number.isFinite(v) || v <= 0)) { setMsg("comfortable level must be positive or empty"); return; }
    const { comfortRating: _c, ...rest } = s;
    void _c;
    await saveSettings({ ...rest, comfortRating: v });
    setMsg("saved");
  }

  const stale = s.lastExportAt ? (Date.now() - s.lastExportAt) > 21 * 86400000 : true;  return (
    <div>
      <h1>settings</h1>
      <p className="sub">data is per-browser/device (indexeddb). cross-device use goes through export/import.</p>

      <section>
        <h2>handles</h2>
        <label className="small">codeforces handle<input type="text" value={s.cfHandle} onChange={(e) => setS({ ...s, cfHandle: e.target.value })} /></label>
        <label className="small">atcoder handle<input type="text" value={s.atcoderHandle} onChange={(e) => setS({ ...s, atcoderHandle: e.target.value })} /></label>
        <label className="small">cses user (best-effort import only)<input type="text" value={s.csesUser} onChange={(e) => setS({ ...s, csesUser: e.target.value })} /></label>
      </section>

      <section>
        <h2>level</h2>
        <label className="small">my comfortable level (problems I can solve)<input type="number" value={s.comfortRating} onChange={(e) => setS({ ...s, comfortRating: e.target.value })} placeholder="empty = estimate" /></label>
        <p className="small muted">a set level overrides the estimate. see the <a href="/skill">skill debug page</a>.</p>
      </section>

      <section>
        <h2>goals</h2>
        <label className="small">difficulty window low (offset)<input type="number" value={s.difficultyLow} onChange={(e) => setS({ ...s, difficultyLow: Number(e.target.value) })} /></label>
        <label className="small">difficulty window high (offset)<input type="number" value={s.difficultyHigh} onChange={(e) => setS({ ...s, difficultyHigh: Number(e.target.value) })} /></label>
        <label className="small">weekly goal<input type="number" value={s.weeklyGoal} onChange={(e) => setS({ ...s, weeklyGoal: Number(e.target.value) })} /></label>
        <label className="small">stuck timeout (minutes)<input type="number" value={s.stuckTimeoutMinutes} onChange={(e) => setS({ ...s, stuckTimeoutMinutes: Number(e.target.value) })} /></label>
        <label className="row small"><input type="checkbox" checked={s.showNextRungs} onChange={(e) => setS({ ...s, showNextRungs: e.target.checked })} /> show next rungs after solve</label>
        <label className="small">warmup minutes<input type="number" value={s.warmupMinutes} onChange={(e) => setS({ ...s, warmupMinutes: Number(e.target.value) })} /></label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={save}>save</button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
      </section>

      <section>
        <h2>backup</h2>
        {stale && <p className="small">last export {s.lastExportAt ? new Date(s.lastExportAt).toLocaleDateString() : "never"} — older than 3 weeks, export a backup.</p>}
        {!stale && <p className="small muted">last export {new Date(s.lastExportAt).toLocaleDateString()}</p>}
        <div className="row">
          <button className="btn" onClick={async () => {
            const blob = await exportAll();
            const text = JSON.stringify(blob);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
            a.download = `cftracker-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            await saveSettings({ lastExportAt: Date.now() });
            const x = await getSettings();
            setS({ ...s, lastExportAt: x.lastExportAt ?? Date.now() });
          }}>export json</button>
          <label className="btn small">import json<input type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const blob = JSON.parse(await f.text());
              await importAll(blob);
              setMsg("imported — reload the app");
            } catch {
              setMsg("import failed: bad file");
            }
          }} /></label>
        </div>
      </section>

      <section>
        <h2>hidden problems</h2>
        <HiddenList />
      </section>

      <section>
        <h2>cses import (best-effort)</h2>
        <button className="btn" onClick={async () => {
          if (!s.csesUser) { setMsg("set cses user first"); return; }
          const res = await fetch(`/api/cses-import?user=${encodeURIComponent(s.csesUser)}`);
          const j = await res.json();
          setMsg(j.ok ? `found ${j.solved.length} solved` : `import unavailable: ${j.reason} — mark manually`);
        }}>try import</button>
      </section>
    </div>
  );
}

function HiddenList() {
  const [rows, setRows] = useState<{ id?: number; problemKey: string; reason: string }[]>([]);
  useEffect(() => {
    db().hiddenProblems.toArray().then((r) => setRows(r));
  }, []);
  if (rows.length === 0) return <p className="small muted">nothing hidden.</p>;
  return (
    <ul className="plain">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="mono small">{r.problemKey}</span>{" "}
          <span className="muted small">{r.reason}</span>{" "}
          <button className="btn" onClick={async () => {
            if (r.id) await db().hiddenProblems.delete(r.id);
            setRows(await db().hiddenProblems.toArray());
          }}>unhide</button>
        </li>
      ))}
    </ul>
  );
}
