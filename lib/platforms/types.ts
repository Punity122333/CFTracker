// Shared platform interface. Each platform exposes fetchSolves + fetchProblems.
// Problem statements are never scraped or stored: title, difficulty, tags, link only.

export type Platform = "codeforces" | "cses" | "atcoder";

export interface NormProblem {
  platform: Platform;
  pid: string;
  key: string;
  title: string;
  difficulty?: number;
  tags: string[];
  url: string;
  solvedCount?: number;
}

export interface NormSubmission {
  platform: Platform;
  problemKey: string;
  verdict: string;
  language?: string;
  timestamp: number;
  contestId?: number;
  submissionId?: string;
}
