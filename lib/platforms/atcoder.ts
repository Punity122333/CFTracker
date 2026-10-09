// AtCoder via kenkoooo AtCoder Problems API (proxy to avoid CORS).
// Caveat: it provides no topic tags, so AtCoder problems have no tags
// unless the user adds them manually.
import { atcoderToCF } from "../skill";
import type { NormProblem, NormSubmission } from "./types";

interface AtCoderSub {
  id: number;
  contest_id: string;
  problem_id: string;
  user_id: string;
  result: string;
  language: string;
  epoch_second: number;
}

export async function fetchSolves(user: string, fromSecond = 0): Promise<NormSubmission[]> {
  const res = await fetch(
    `/api/atcoder?type=submissions&user=${encodeURIComponent(user)}&from=${fromSecond}`
  );
  if (!res.ok) throw new Error(`atcoder proxy failed: ${res.status}`);
  const arr = (await res.json()) as AtCoderSub[];
  return arr.map((s) => ({
    platform: "atcoder" as const,
    problemKey: `atcoder:${s.contest_id}:${s.problem_id}`,
    verdict: s.result === "AC" ? "OK" : s.result,
    language: s.language,
    timestamp: s.epoch_second * 1000,
    submissionId: String(s.id),
  }));
}

export async function fetchProblems(): Promise<NormProblem[]> {
  const res = await fetch(`/api/atcoder?type=problems`);
  if (!res.ok) throw new Error(`atcoder proxy failed: ${res.status}`);
  const arr = (await res.json()) as { id: string; contest_id: string; title: string }[];
  return arr.map((p) => ({
    platform: "atcoder" as const,
    pid: `${p.contest_id}:${p.id}`,
    key: `atcoder:${p.contest_id}:${p.id}`,
    title: p.title,
    difficulty: undefined,
    tags: [],
    url: `https://atcoder.jp/contests/${p.contest_id}/tasks/${p.id}`,
  }));
}

export async function fetchDifficulties(): Promise<Record<string, number>> {
  const res = await fetch(`/api/atcoder?type=models`);
  if (!res.ok) return {};
  const j = (await res.json()) as Record<string, { difficulty?: number }>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j)) {
    if (typeof v.difficulty === "number") out[k] = v.difficulty;
  }
  return out;
}

// Problems joined with kenkoooo difficulty, normalized to the CF scale
// at ingestion so raw AtCoder values never enter CF comparisons.
export async function fetchProblemsWithDifficulty(): Promise<NormProblem[]> {
  const [problems, models] = await Promise.all([fetchProblems(), fetchDifficulties()]);
  return problems.map((p) => {
    const raw = models[p.pid.split(":")[1]];
    return { ...p, difficulty: raw != null ? atcoderToCF(raw) : undefined };
  });
}
