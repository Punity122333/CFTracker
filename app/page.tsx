"use client";

import { useEffect, useMemo, useState } from "react";
import { db, getSettings } from "@/lib/db";
import { buildCandidates, buildSkillSnapshot, loadHiddenKeys, maybeSnapshot, rankContextFromSnapshot } from "@/lib/skillContext";
import { dailyPick, rankCandidates, type RankedCandidate } from "@/lib/recommend";
import { fetchSolves, fetchProblems, cfRatingHistory, cfContests, cfUserInfo } from "@/lib/platforms/codeforces";
import * as atcoder from "@/lib/platforms/atcoder";
import { csesTopicIds } from "@/lib/platforms/cses";
import csesData from "@/data/cses.json";

interface Sub {
  platform: string;
  problemKey: string;
  verdict: string;
  language?: string;
  timestamp: number;
}

function bucket(r?: number): string {
  if (r == null) return "unrated";
  if (r < 1200) return "800-1199";
  if (r < 1500) return "1200-1499";
  if (r < 1800) return "1500-1799";
  if (r < 2100) return "1800-2099";
  return "2100+";
}

export default function Dashboard() {
  const [settings, setSettings] = useState({ cfHandle: "", atcoderHandle: "", weeklyGoal: 5 });
  const [subs, setSubs] = useState<Sub[]>([]);
  const [rating, setRating] = useState<{ t: number; rating: number; contestId: number }[]>([]);
  const [contests, setContests] = useState<{ id: number; name: string; start: number; phase: string }[]>([]);
  const [syncAt, setSyncAt] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");
  const [syncing, setSyncing] = useState<"" | "cf" | "ac">("");
  const [daily, setDaily] = useState<RankedCandidate | null>(null);
  const [titles, setTitles] = useState<Record<string, { title: string; difficulty?: number; tags: string[] }>>({});
  const [history, setHistory] = useState<{ date: string; globalTheta: number }[]>([]);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setSettings({ cfHandle: s.cfHandle, atcoderHandle: s.atcoderHandle, weeklyGoal: s.weeklyGoal });
      const all = await db().submissions.toArray();
      setSubs(all);
      const probs = await db().problems.toArray();
      const m: Record<string, { title: string; difficulty?: number; tags: string[] }> = {};
      for (const p of probs) m[p.key] = { title: p.title, difficulty: p.difficulty, tags: p.tags };
      setTitles(m);
      const meta = await db().syncMeta.toArray();
      const sm: Record<string, number> = {};
      for (const r of meta) sm[r.platform] = r.lastSyncAt;
      setSyncAt(sm);
      const snaps = await db().abilitySnapshots.orderBy("date").toArray();
      setHistory(snaps.map((r) => ({ date: r.date, globalTheta: r.globalTheta })));
    })();
  }, []);

  async function syncCF() {
    if (!settings.cfHandle) { setMsg("set codeforces handle in settings first"); return; }
    if (syncing) return;
    setSyncing("cf");
    setMsg("syncing codeforces…");
    try {
      const solves = await fetchSolves(settings.cfHandle);
      const probs = await fetchProblems();
      const info = await cfUserInfo(settings.cfHandle).catch(() => ({ rating: 0, maxRating: 0 }));
      const d = db();
      const now = Date.now();
      await d.transaction("rw", d.problems, d.submissions, d.syncMeta, d.settings, async () => {
        for (const p of probs.slice(0, 9000)) {
          await d.problems.put({ key: p.key, platform: "codeforces", pid: p.pid, title: p.title, difficulty: p.difficulty, tags: p.tags, url: p.url, updatedAt: now, solvedCount: p.solvedCount });
        }
        for (const s of solves) {
          const exists = await d.submissions.where("submissionId").equals(s.submissionId ?? "").count();
          if (exists === 0) await d.submissions.add({ ...s, platform: "codeforces" });
        }
        const prev = await d.syncMeta.where("platform").equals("codeforces").first();
        if (prev?.id) await d.syncMeta.update(prev.id, { lastSyncAt: now });
        else await d.syncMeta.add({ platform: "codeforces", lastSyncAt: now });
        const st = await d.settings.toCollection().first();
        if (st?.id && info.rating > 0) {
          await d.settings.update(st.id, {
            cfRating: info.rating,
            ...(info.maxRating > 0 ? { cfMaxRating: info.maxRating } : {}),
          });
        }
      });
      const hist = await cfRatingHistory(settings.cfHandle);
      setRating(hist);
      // Persist contest end-time windows for in-contest evidence.
      const windows: Record<string, number> = {};
      for (const h of hist) windows[String(h.contestId)] = h.t;
      const st2 = await d.settings.toCollection().first();
      if (st2?.id && hist.length > 0) {
        const merged = { ...(st2.cfContestWindows ?? {}), ...windows };
        await d.settings.update(st2.id, { cfContestWindows: merged });
      }
      const all = await d.submissions.toArray();
      setSubs(all);
      setSyncAt((s) => ({ ...s, codeforces: now }));
      setMsg(`synced ${solves.length} submissions`);
    } catch (e) {
      setMsg(`sync failed: ${(e as Error).message} (showing cached data)`);
    } finally {
      setSyncing("");
    }
  }

  async function syncAtCoder() {
    if (!settings.atcoderHandle) { setMsg("set atcoder handle in settings first"); return; }
    if (syncing) return;
    setSyncing("ac");
    setMsg("syncing atcoder…");
    try {
      const solves = await atcoder.fetchSolves(settings.atcoderHandle);
      const aprobs = await atcoder.fetchProblemsWithDifficulty().catch(() => []);
      const d = db();
      const now = Date.now();
      for (const p of aprobs) {
        await d.problems.put({ key: p.key, platform: "atcoder", pid: p.pid, title: p.title, difficulty: p.difficulty, tags: [], url: p.url, updatedAt: now });
      }
      for (const s of solves) {
        const exists = await d.submissions.where("submissionId").equals(s.submissionId ?? "").count();
        if (exists === 0) await d.submissions.add({ ...s, platform: "atcoder" });
      }
      const prev = await d.syncMeta.where("platform").equals("atcoder").first();
      if (prev?.id) await d.syncMeta.update(prev.id, { lastSyncAt: now });
      else await d.syncMeta.add({ platform: "atcoder", lastSyncAt: now });
      const all = await d.submissions.toArray();
      setSubs(all);
      setSyncAt((s) => ({ ...s, atcoder: now }));
      setMsg(`synced ${solves.length} atcoder submissions`);
    } catch (e) {
      setMsg(`sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing("");
    }
  }

  useEffect(() => {
    cfContests().then(setContests).catch(() => undefined);
  }, []);

  const solvedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const x of subs) {
      if (x.verdict === "OK") s.add(x.problemKey);
    }
    return s;
  }, [subs]);

  const perPlatform = useMemo(() => {
    const m: Record<string, number> = {};
    for (const k of solvedKeys) {
      const p = k.split(":")[0];
      m[p] = (m[p] ?? 0) + 1;
    }
    return m;
  }, [solvedKeys]);

  const byBucket = useMemo(() => {
    const m: Record<string, number> = {};
    for (const k of solvedKeys) {
      m[bucket(titles[k]?.difficulty)] = (m[bucket(titles[k]?.difficulty)] ?? 0) + 1;
    }
    return m;
  }, [solvedKeys, titles]);

  const byTag = useMemo(() => {
    const att = new Map<string, number>();
    const sol = new Map<string, number>();
    const seenAtt = new Set<string>();
    for (const x of subs) {
      const tags = titles[x.problemKey]?.tags ?? [];
      for (const t of tags) {
        const k = `${t}::${x.problemKey}`;
        if (!seenAtt.has(k)) { seenAtt.add(k); att.set(t, (att.get(t) ?? 0) + 1); }
      }
    }
    for (const k of solvedKeys) {
      for (const t of titles[k]?.tags ?? []) sol.set(t, (sol.get(t) ?? 0) + 1);
    }
    return [...att.entries()].map(([t, a]) => ({ tag: t, attempted: a, solved: sol.get(t) ?? 0 }));
  }, [subs, solvedKeys, titles]);

  const verdicts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of subs) m[x.verdict] = (m[x.verdict] ?? 0) + 1;
    return m;
  }, [subs]);

  const langs = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of subs) if (x.language) m[x.language] = (m[x.language] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [subs]);

  const heat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of subs) {
      if (x.verdict !== "OK") continue;
      const d = new Date(x.timestamp).toISOString().slice(0, 10);
      m[d] = (m[d] ?? 0) + 1;
    }
    const days: { date: string; n: number }[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push({ date: d, n: m[d] ?? 0 });
    }
    return days;
  }, [subs]);

  const streak = useMemo(() => {
    let s = 0;
    const set = new Set(heat.filter((h) => h.n > 0).map((h) => h.date));
    let cur = new Date();
    if (!set.has(cur.toISOString().slice(0, 10))) cur = new Date(Date.now() - 86400000);
    while (set.has(cur.toISOString().slice(0, 10))) { s++; cur = new Date(cur.getTime() - 86400000); }
    return s;
  }, [heat]);

  const weekSolved = useMemo(() => {
    const cut = Date.now() - 7 * 86400000;
    return new Set(subs.filter((x) => x.verdict === "OK" && x.timestamp >= cut).map((x) => x.problemKey)).size;
  }, [subs]);

  const timeOfDay = useMemo(() => {
    const hrs = new Array(24).fill(0);
    for (const x of subs) {
      if (x.verdict !== "OK") continue;
      hrs[new Date(x.timestamp).getHours()]++;
    }
    const best = hrs.indexOf(Math.max(...hrs));
    return { hrs, best };
  }, [subs]);

  useEffect(() => {
    (async () => {
      try {
        const [snap, cands, hidden] = await Promise.all([
          buildSkillSnapshot(), buildCandidates(), loadHiddenKeys(),
        ]);
        // Snapshot the app's own ability history (at most one per day).
        await maybeSnapshot(snap);
        const { ranked } = rankCandidates(
          rankContextFromSnapshot(snap),
          cands,
          { limit: 50, hiddenKeys: hidden }
        );
        const day = new Date().toISOString().slice(0, 10);
        setDaily(dailyPick(day, settings.cfHandle || settings.atcoderHandle || "local", ranked));
      } catch {
        setDaily(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs]);

  const upcoming = contests.filter((c) => c.phase === "BEFORE").slice(0, 5);

  return (
    <div>
      <h1>dashboard</h1>
      <p className="sub">sync handles, counts, rating, contests. data is per-browser; use settings export for other devices.</p>

      <div className="stats">
        <div className="stat">
          <div className="stat-num accent">{solvedKeys.size}</div>
          <div className="stat-label">solved total</div>
          <div className="stat-sub mono">{perPlatform.codeforces ?? 0} cf · {perPlatform.cses ?? 0} cses · {perPlatform.atcoder ?? 0} ac</div>
        </div>
        <div className="stat">
          <div className="stat-num">{streak}d</div>
          <div className="stat-label">day streak</div>
          <div className="stat-sub">{heat.filter((h) => h.n > 0).length} active days / 28</div>
        </div>
        <div className="stat">
          <div className="stat-num good">{weekSolved}<span className="muted" style={{ fontSize: 15 }}>/{settings.weeklyGoal}</span></div>
          <div className="stat-label">this week</div>
          <div className="stat-sub">{weekSolved >= settings.weeklyGoal ? "goal met" : `${settings.weeklyGoal - weekSolved} to go`}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{rating.length > 0 ? rating[rating.length - 1].rating : "—"}</div>
          <div className="stat-label">cf rating</div>
          <div className="stat-sub">{rating.length > 0 ? `${rating.length} contests` : "sync to load"}</div>
        </div>
      </div>

      {daily && (
        <section>
          <h2>daily problem</h2>
          <div className="spotlight">
            <a href={daily.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{daily.title}</a>{" "}
            <span className="muted mono small">{daily.key}{daily.difficulty ? ` · ${daily.difficulty}` : ""}</span>
            <p className="small muted" style={{ margin: "2px 0 0" }}>{daily.reason} — pinned for today.</p>
          </div>
        </section>
      )}

      <section>
        <h2>sync</h2>
        <ul className="plain">
          <li>
            <span className="row">
              <span>codeforces: {settings.cfHandle || "(not set)"}</span>
              <button className="btn primary" disabled={syncing !== ""} onClick={syncCF}>{syncing === "cf" ? "syncing…" : "sync"}</button>
              {syncAt.codeforces && <span className="muted small">last synced {new Date(syncAt.codeforces).toLocaleString()}</span>}
            </span>
          </li>
          <li>
            <span className="row">
              <span>atcoder: {settings.atcoderHandle || "(not set)"}</span>
              <button className="btn primary" disabled={syncing !== ""} onClick={syncAtCoder}>{syncing === "ac" ? "syncing…" : "sync"}</button>
              {syncAt.atcoder && <span className="muted small">last synced {new Date(syncAt.atcoder).toLocaleString()}</span>}
            </span>
          </li>
          <li>
            <span>cses: static list ({(csesData as { problems: unknown[] }).problems.length} problems), manual marking primary. cses ids: {csesTopicIds().size} mapped.</span>
          </li>
        </ul>
        {msg && <p className="small muted">{msg}</p>}
      </section>

      <section>
        <h2>solve counts</h2>
        <table className="plain">
          <thead><tr><th>platform</th><th>solved</th></tr></thead>
          <tbody>
            {Object.entries(perPlatform).map(([p, n]) => (
              <tr key={p}><td>{p}</td><td className="mono">{n}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>by rating bucket</h2>
        <table className="plain">
          <thead><tr><th>bucket</th><th>solved</th><th style={{ width: "45%" }}>share</th></tr></thead>
          <tbody>
            {(() => {
              const max = Math.max(1, ...Object.values(byBucket));
              return Object.entries(byBucket).map(([b, n]) => (
                <tr key={b}>
                  <td className="mono">{b}</td>
                  <td className="mono">{n}</td>
                  <td><div className="bar"><div className="bar-fill" style={{ width: `${Math.round((n / max) * 100)}%` }} /></div></td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </section>

      <section>
        <h2>solved per tag vs attempted</h2>
        <table className="plain">
          <thead><tr><th>tag</th><th>solved</th><th>attempted</th><th style={{ width: "35%" }}>solve rate</th></tr></thead>
          <tbody>
            {byTag.slice(0, 20).map((r) => {
              const pct = r.attempted ? Math.round((r.solved / r.attempted) * 100) : 0;
              return (
                <tr key={r.tag}>
                  <td>{r.tag}</td>
                  <td className="mono">{r.solved}</td>
                  <td className="mono">{r.attempted}</td>
                  <td>
                    <div className="row">
                      <div className="bar" style={{ flex: 1 }}><div className="bar-fill good" style={{ width: `${pct}%` }} /></div>
                      <span className="mono small muted">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>activity (28d) — streak {streak}d</h2>
        <div className="panel">
          {(() => {
            const level = (n: number) => (n >= 4 ? "h4" : n >= 3 ? "h3" : n >= 2 ? "h2" : n >= 1 ? "h1" : "");
            const startPad = new Date(heat[0]?.date ?? Date.now()).getDay();
            const cells: ({ date: string; n: number } | null)[] = [
              ...Array.from({ length: startPad }, () => null),
              ...heat,
            ];
            const cols = Math.ceil(cells.length / 7);
            const ordered: typeof cells = [];
            for (let r = 0; r < 7; r++) for (let c = 0; c < cols; c++) ordered.push(cells[c * 7 + r]);
            return (
              <div>
                <div className="heat" style={{ gridTemplateColumns: `repeat(${cols}, 13px)` }}>
                  {ordered.map((h, i) =>
                    h ? (
                      <div key={i} className={`heat-cell ${level(h.n)}`} title={`${h.date}: ${h.n} solved`} />
                    ) : (
                      <div key={i} className="heat-cell" style={{ visibility: "hidden" }} />
                    )
                  )}
                </div>
                <div className="row small muted" style={{ marginTop: 8 }}>
                  <span>{heat.filter((h) => h.n > 0).length} active days</span>
                  <span className="heat-legend" style={{ marginLeft: "auto" }}>
                    less
                    <span className="heat-cell" /> <span className="heat-cell h1" /> <span className="heat-cell h2" /> <span className="heat-cell h3" /> <span className="heat-cell h4" />
                    more
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {rating.length > 0 && (() => {
        const rs = rating.map((r) => r.rating);
        const mn = Math.min(...rs);
        const mx = Math.max(...rs);
        const span = Math.max(1, mx - mn);
        const pts = rating.map((r, i) => {
          const x = 8 + (i / Math.max(1, rating.length - 1)) * 684;
          const y = 66 - ((r.rating - mn) / span) * 52;
          return `${x},${y}`;
        });
        const last = pts[pts.length - 1].split(",");
        return (
          <section>
            <h2>codeforces rating</h2>
            <div className="panel">
              <div className="row small" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                <span className="mono" style={{ color: "var(--good)", fontWeight: 700 }}>▲ {mx}</span>
                <span className="muted">{rating.length} contests</span>
                <span className="mono muted">▼ {mn}</span>
              </div>
              <svg width="100%" height="90" viewBox="0 0 700 90" role="img" aria-label="rating graph" style={{ display: "block" }}>
                <line x1="8" y1="79" x2="692" y2="79" stroke="var(--hairline)" strokeWidth="1" />
                <polyline
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={pts.join(" ")}
                />
                <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--accent)" />
              </svg>
              <p className="small muted mono" style={{ margin: "4px 0 0" }}>now {rating[rating.length - 1]?.rating}</p>
            </div>
          </section>
        );
      })()}

      {history.length >= 2 && (() => {
        const vals = history.map((h) => h.globalTheta);
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        const span = Math.max(1, mx - mn);
        const pts = history.map((h, i) => {
          const x = 40 + (i / Math.max(1, history.length - 1)) * 644;
          const y = 60 - ((h.globalTheta - mn) / span) * 46;
          return `${x},${y}`;
        });
        const first = history[0];
        const lastH = history[history.length - 1];
        return (
          <section>
            <h2>ability over time</h2>
            <div className="panel">
              <svg width="100%" height="80" viewBox="0 0 700 80" role="img" aria-label="ability history" style={{ display: "block" }}>
                <line x1="40" y1="68" x2="684" y2="68" stroke="var(--hairline)" strokeWidth="1" />
                <polyline fill="none" stroke="var(--good)" strokeWidth="2" strokeLinejoin="round" points={pts.join(" ")} />
              </svg>
              <div className="row small" style={{ justifyContent: "space-between" }}>
                <span className="mono muted">{first.date} · {first.globalTheta}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{lastH.date} · {lastH.globalTheta}</span>
              </div>
            </div>
          </section>
        );
      })()}

      <section>
        <h2>weekly goal — {weekSolved}/{settings.weeklyGoal}</h2>
        <p className="mono">{weekSolved >= settings.weeklyGoal ? "met" : `${settings.weeklyGoal - weekSolved} to go`}</p>
      </section>

      <section>
        <h2>verdicts / languages</h2>
        <table className="plain">
          <thead><tr><th>verdict</th><th>n</th></tr></thead>
          <tbody>
            {Object.entries(verdicts).map(([v, n]) => (
              <tr key={v}><td className="mono">{v}</td><td className="mono">{n}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="small muted mono">{langs.map(([l, n]) => `${l} ${n}`).join(" · ")}</p>
      </section>

      <section>
        <h2>time of day</h2>
        <p className="small">most accepts around hour <span className="mono">{timeOfDay.best}:00</span></p>
      </section>

      <section>
        <h2>upcoming contests</h2>
        <ul className="plain">
          {upcoming.map((c) => (
            <li key={c.id}><span>{c.name}</span> <span className="muted small mono">{new Date(c.start).toLocaleString()}</span></li>
          ))}
          {upcoming.length === 0 && <li className="muted">none cached — sync codeforces first</li>}
        </ul>
      </section>
    </div>
  );
}
