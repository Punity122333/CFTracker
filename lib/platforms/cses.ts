// CSES: no official API. Static list in data/cses.json is the source of truth.
// Manual marking of solved status is the primary path. Auto-import from the
// public user page is best-effort only.
import cses from "../../data/cses.json";
import type { NormProblem } from "./types";

interface CsesEntry {
  id: string;
  title: string;
  section: string;
  topicIds: string[];
  url: string;
}

export async function fetchProblems(): Promise<NormProblem[]> {
  const list = (cses as { problems: CsesEntry[] }).problems;
  return list.map((p) => ({
    platform: "cses" as const,
    pid: p.id,
    key: `cses:${p.id}`,
    title: p.title,
    difficulty: undefined,
    tags: [],
    url: p.url,
  }));
}

export function csesTopicIds(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of (cses as { problems: CsesEntry[] }).problems) {
    m.set(`cses:${p.id}`, p.topicIds ?? []);
  }
  return m;
}
