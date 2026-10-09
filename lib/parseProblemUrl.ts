// Parse a pasted problem URL into { platform, id }.
// Supports Codeforces, CSES, AtCoder. Returns null on malformed input.

export type Platform = "codeforces" | "cses" | "atcoder";

export interface ParsedProblemUrl {
  platform: Platform;
  id: string;
}

export function parseProblemUrl(raw: string): ParsedProblemUrl | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  // Codeforces: /contest/1234/problem/A , /problemset/problem/1234/A ,
  //   /problemsets/acmsguru/problem/... (unsupported), /gym/... (unsupported)
  if (host === "codeforces.com" || host === "www.codeforces.com") {
    let m = path.match(/^\/(?:contest|problemset)\/problem\/(\d+)\/([A-Za-z0-9]+)\/?$/);
    if (m) return { platform: "codeforces", id: `${m[1]}${m[2].toUpperCase()}` };
    m = path.match(/^\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)\/?$/);
    if (m) return { platform: "codeforces", id: `${m[1]}${m[2].toUpperCase()}` };
    return null;
  }

  // CSES: /problemset/task/<id>  (numeric)
  if (host === "cses.fi" || host === "www.cses.fi") {
    const m = path.match(/^\/problemset\/task\/(\d+)\/?$/);
    if (m) return { platform: "cses", id: m[1] };
    return null;
  }

  // AtCoder: /contests/<contest>/tasks/<taskid>
  if (host === "atcoder.jp" || host === "www.atcoder.jp") {
    const m = path.match(/^\/contests\/([a-z0-9_-]+)\/tasks\/([a-z0-9_-]+)\/?$/i);
    if (m) return { platform: "atcoder", id: `${m[1]}:${m[2]}` };
    return null;
  }

  return null;
}

export function problemKey(platform: Platform, id: string): string {
  return `${platform}:${id}`;
}

export function problemUrlFor(platform: Platform, id: string): string {
  if (platform === "codeforces") {
    const m = id.match(/^(\d+)([A-Z0-9]+)$/i);
    if (m) return `https://codeforces.com/problemset/problem/${m[1]}/${m[2].toUpperCase()}`;
    return `https://codeforces.com/problemset/problem/${id}`;
  }
  if (platform === "cses") return `https://cses.fi/problemset/task/${id}`;
  const [contest, task] = id.split(":");
  if (contest && task) return `https://atcoder.jp/contests/${contest}/tasks/${task}`;
  return `https://atcoder.jp/contests/${id}`;
}
