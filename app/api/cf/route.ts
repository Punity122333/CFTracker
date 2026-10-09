import { NextRequest, NextResponse } from "next/server";

// Thin proxy/cache for the Codeforces API (avoids CORS, adds caching).
// Stateless: no module-level cache; uses fetch revalidate + Cache-Control.
export const runtime = "nodejs";

const TTL: Record<string, number> = {
  "problemset.problems": 6 * 3600,
  "contest.list": 30 * 60,
  "user.status": 120,
  "user.info": 120,
  "user.rating": 30 * 60,
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const method = q.get("method") ?? "";
  const allowed = new Set([
    "user.info",
    "user.status",
    "user.rating",
    "problemset.problems",
    "contest.list",
  ]);
  if (!allowed.has(method)) {
    return NextResponse.json({ error: "bad method" }, { status: 400 });
  }
  const params = new URLSearchParams();
  q.forEach((v, k) => {
    if (k !== "method") params.set(k, v);
  });
  const url = `https://codeforces.com/api/${method}?${params.toString()}`;
  const revalidate = TTL[method] ?? 120;
  try {
    const upstream = await fetch(url, { next: { revalidate } });
    const text = await upstream.text();
    if (upstream.status === 503 || text.includes("Call limit exceeded")) {
      return NextResponse.json(
        { error: "codeforces throttled, retry later" },
        {
          status: 429,
          headers: {
            "retry-after": "5",
            "Cache-Control": "no-store",
          },
        }
      );
    }
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=60`,
      },
    });
  } catch {
    return NextResponse.json({ error: "upstream fetch failed" }, { status: 502 });
  }
}
