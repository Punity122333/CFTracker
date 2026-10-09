"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db, getSettings } from "@/lib/db";
import { cfContests } from "@/lib/platforms/codeforces";
import {
  buildCandidates,
  buildSkillSnapshot,
  loadHiddenKeys,
  rankContextFromSnapshot,
  type SkillSnapshot,
} from "@/lib/skillContext";
import { warmupPicks, type Candidate, type RankedCandidate } from "@/lib/recommend";
import { WARMUP_BELOW, WARMUP_COUNT, WARMUP_DEFAULT_MINUTES } from "@/lib/tuning";

interface Contest { id: number; name: string; start: number; phase: string }

export default function Contests() {
  return (
    <Suspense>
      <ContestsInner />
    </Suspense>
  );
}

function ContestsInner() {
  const params = useSearchParams();
  const [contests, setContests] = useState<Contest[]>([]);
  const [participated, setParticipated] = useState<number[]>([]);
  const [upsolve, setUpsolve] = useState<{ contestId: number; problemKey: string; title: string }[]>([]);
  const [virtualId, setVirtualId] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [snap, setSnap] = useState<SkillSnapshot | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<RankedCandidate[] | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [warmLeft, setWarmLeft] = useState(0);
  const [warmRunning, setWarmRunning] = useState(false);
  const [warmTotal, setWarmTotal] = useState(WARMUP_DEFAULT_MINUTES * 60);
  const [warmCount, setWarmCount] = useState("");

  useEffect(() => {
    cfContests().then(setContests).catch(() => undefined);
    (async () => {
      const [s, c, h, st] = await Promise.all([
        buildSkillSnapshot(), buildCandidates(), loadHiddenKeys(), getSettings(),
      ]);
      setSnap(s);
      setCands(c);
      setHidden(h);
      setWarmTotal((st.warmupMinutes ?? WARMUP_DEFAULT_MINUTES) * 60);
      const subs = await db().submissions.toArray();
      const set = new Set(subs.filter((s2) => s2.contestId).map((s2) => s2.contestId as number));
      setParticipated([...set]);
      const probs = await db().problems.toArray();
      const solved = new Set(subs.filter((s2) => s2.verdict === "OK").map((s2) => s2.problemKey));
      const missing: { contestId: number; problemKey: string; title: string }[] = [];
      for (const p of probs) {
        const cid = Number(p.key.match(/^codeforces:(\d+)/)?.[1]);
        if (cid && set.has(cid) && !solved.has(p.key)) {
          missing.push({ contestId: cid, problemKey: p.key, title: p.title });
        }
      }
      // todo items flagged for upsolve join the same list
      const flagged = (await db().todoItems.toArray()).filter((t) => t.upsolve && !t.done && !t.solved);
      const have = new Set(missing.map((m) => m.problemKey));
      for (const t of flagged) {
        if (have.has(t.problemKey) || solved.has(t.problemKey)) continue;
        const p = probs.find((x) => x.key === t.problemKey);
        missing.push({ contestId: -1, problemKey: t.problemKey, title: p?.title ?? t.problemKey });
      }
      setUpsolve(missing.slice(0, 50));
      const warmups = await db().warmups.toArray();
      const recent = warmups.filter((w) => w.startedAt >= Date.now() - 30 * 86400000).length;
      setWarmCount(`${recent} warmup${recent === 1 ? "" : "s"} in the last 30 days`);
      if (params.get("warmup") === "1" && s && c.length > 0) {
        startWarmup(s, c, h);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function startWarmup(s = snap, c = cands, h = hidden) {
    if (!s) return;
    const picks = warmupPicks(rankContextFromSnapshot(s), c, WARMUP_COUNT, WARMUP_BELOW);
    const filtered = picks.filter((p) => !h.has(p.key));
    setSession(filtered.slice(0, WARMUP_COUNT));
    setTicks({});
    setWarmLeft(warmTotal);
    setWarmRunning(true);
  }

  useEffect(() => {
    if (!warmRunning) return;
    if (warmLeft <= 0) {
      setWarmRunning(false);
      return;
    }
    const iv = setInterval(() => setWarmLeft((v) => v - 1), 1000);
    return () => clearInterval(iv);
  }, [warmRunning, warmLeft]);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [running]);

  async function logWarmup() {
    if (!session) return;
    const solvedKeys = session.filter((p) => ticks[p.key]).map((p) => p.key);
    await db().warmups.add({
      startedAt: Date.now(),
      problemKeys: session.map((p) => p.key),
      solvedKeys,
      durationSec: warmTotal - warmLeft,
    });
    setSession(null);
    setWarmRunning(false);
    const warmups = await db().warmups.toArray();
    const recent = warmups.filter((w) => w.startedAt >= Date.now() - 30 * 86400000).length;
    setWarmCount(`${recent} warmup${recent === 1 ? "" : "s"} in the last 30 days`);
  }

  const upcoming = contests.filter((c) => c.phase === "BEFORE").slice(0, 10);

  return (
    <div>
      <h1>contests</h1>
      <p className="sub">upsolve what you missed, warm up before contests, run a virtual timer.</p>

      <section>
        <h2>calendar</h2>
        <ul className="plain">
          {upcoming.map((c) => (
            <li key={c.id}>{c.name} <span className="muted small mono">{new Date(c.start).toLocaleString()}</span></li>
          ))}
          {upcoming.length === 0 && <li className="muted">no cached contests — sync from dashboard</li>}
        </ul>
      </section>

      <section>
        <h2>warmup</h2>
        <div className="row">
          <button className="btn primary" onClick={() => startWarmup()}>warmup</button>
          {warmCount && <span className="small muted">{warmCount}</span>}
        </div>
        {session && (
          <div style={{ marginTop: 8 }}>
            <p className="small muted">
              3 problems below your level, distinct topics.{" "}
              <span className="mono">{Math.floor(warmLeft / 60)}:{String(warmLeft % 60).padStart(2, "0")}</span> left.
              {session.length < 3 && " pool too small, fewer problems."}
            </p>
            <ul className="plain">
              {session.map((p) => (
                <li key={p.key} className="small">
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={!!ticks[p.key]}
                      onChange={() => setTicks({ ...ticks, [p.key]: !ticks[p.key] })}
                    />
                    <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a>{" "}
                    <span className="mono muted">{p.difficulty}</span>
                  </label>
                  <div className="muted">{p.reason}</div>
                </li>
              ))}
            </ul>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={logWarmup}>log result</button>
              <button className="btn" onClick={() => { setSession(null); setWarmRunning(false); }}>discard</button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>upsolve ({upsolve.length})</h2>
        <ul className="plain">
          {upsolve.map((u) => (
            <li key={u.problemKey}>
              {u.title} <span className="muted small mono">{u.contestId > 0 ? `contest ${u.contestId}` : "todo"}</span>{" "}
              <button className="btn" onClick={async () => {
                const d = db();
                const n = await d.todoItems.where("problemKey").equals(u.problemKey).count();
                if (n === 0) await d.todoItems.add({
                  problemKey: u.problemKey, solved: false, implemented: false, understood: false,
                  solvedWithoutHelp: false, stuck: false, hintLevelUsed: 0, logic: "",
                  acceptedCode: "", keyTrick: "", selfCheck: { observation: false, complexity: false, edgeCases: false },
                  timerSeconds: 0, addedAt: Date.now(),
                });
              }}>add to todo</button>
            </li>
          ))}
        </ul>
        <p className="small muted">participated contests: {participated.join(", ") || "none synced"}</p>
      </section>

      <section>
        <h2>virtual contest</h2>
        <div className="row">
          <input type="text" placeholder="past contest id, e.g. 1791" value={virtualId} onChange={(e) => setVirtualId(e.target.value)} style={{ maxWidth: 200 }} />
          <button className="btn" onClick={() => { setSeconds(0); setRunning(true); }}>{running ? "restart" : "start"}</button>
          <button className="btn" onClick={() => setRunning(false)}>stop</button>
          <span className="mono">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
        </div>
        {virtualId && <p className="small"><a href={`https://codeforces.com/contest/${virtualId}`} target="_blank" rel="noreferrer">open contest {virtualId}</a></p>}
      </section>
    </div>
  );
}
