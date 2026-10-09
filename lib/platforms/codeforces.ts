// Codeforces client. Goes through /api/cf proxy (cached) + client-side queue.
import { cfQueue } from "../rateLimit";
import type { NormProblem, NormSubmission } from "./types";

async function get(path: string): Promise<unknown> {
  return cfQueue(async () => {
    const res = await fetch(`/api/cf?${path}`);
    if (res.status === 429) throw new Error("codeforces throttled, retry later");
    if (!res.ok) throw new Error(`codeforces proxy failed: ${res.status}`);
    return res.json();
  });
}

export async function cfUserInfo(handle: string): Promise<{ rating: number; maxRating: number }> {
  const j = (await get(`method=user.info&handle=${encodeURIComponent(handle)}`)) as {
    result: { rating?: number; maxRating?: number }[];
  };
  return { rating: j.result?.[0]?.rating ?? 0, maxRating: j.result?.[0]?.maxRating ?? 0 };
}

export async function fetchProblems(): Promise<NormProblem[]> {
  const j = (await get(`method=problemset.problems`)) as {
    result: {
      problems: { contestId: number; index: string; name: string; rating?: number; tags: string[] }[];
      problemStatistics: { contestId: number; index: string; solvedCount: number }[];
    };
  };
  const solvedByPid = new Map(
    (j.result?.problemStatistics ?? []).map((s) => [`${s.contestId}${s.index}`, s.solvedCount])
  );
  return (j.result?.problems ?? []).map((p) => ({
    platform: "codeforces" as const,
    pid: `${p.contestId}${p.index}`,
    key: `codeforces:${p.contestId}${p.index}`,
    title: p.name,
    difficulty: p.rating,
    tags: p.tags ?? [],
    url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
    solvedCount: solvedByPid.get(`${p.contestId}${p.index}`),
  }));
}

export async function fetchSolves(handle: string): Promise<NormSubmission[]> {
  const j = (await get(
    `method=user.status&handle=${encodeURIComponent(handle)}&count=1000`
  )) as {
    result: {
      id: number;
      verdict?: string;
      programmingLanguage?: string;
      creationTimeSeconds: number;
      contestId?: number;
      problem: { contestId?: number; index?: string };
    }[];
  };
  return (j.result ?? []).map((s) => ({
    platform: "codeforces" as const,
    problemKey: `codeforces:${s.problem?.contestId ?? 0}${s.problem?.index ?? ""}`,
    verdict: s.verdict ?? "UNKNOWN",
    language: s.programmingLanguage,
    timestamp: s.creationTimeSeconds * 1000,
    contestId: s.contestId,
    submissionId: String(s.id),
  }));
}

export async function cfRatingHistory(handle: string): Promise<{ t: number; rating: number; contestId: number }[]> {
  const j = (await get(`method=user.rating&handle=${encodeURIComponent(handle)}`)) as {
    result: { ratingUpdateTimeSeconds: number; newRating: number; contestId: number }[];
  };
  return (j.result ?? []).map((r) => ({
    t: r.ratingUpdateTimeSeconds * 1000,
    rating: r.newRating,
    contestId: r.contestId,
  }));
}

export async function cfContests(): Promise<{ id: number; name: string; start: number; phase: string }[]> {
  const j = (await get(`method=contest.list`)) as {
    result: { id: number; name: string; startTimeSeconds?: number; phase: string }[];
  };
  return (j.result ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    start: (c.startTimeSeconds ?? 0) * 1000,
    phase: c.phase,
  }));
}
