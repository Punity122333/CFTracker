import { NextRequest, NextResponse } from "next/server";

// Proxy for kenkoooo AtCoder Problems API (avoids CORS, adds caching).
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const type = q.get("type") ?? "";
  try {
    if (type === "submissions") {
      const user = q.get("user") ?? "";
      const from = q.get("from") ?? "0";
      if (!user) return NextResponse.json([], { status: 200 });
      const url = `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user)}&from_second=${encodeURIComponent(from)}`;
      const up = await fetch(url, { next: { revalidate: 120 } });
      const text = await up.text();
      return new NextResponse(text, {
        status: up.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60",
        },
      });
    }
    if (type === "problems") {
      const up = await fetch("https://kenkoooo.com/atcoder/resources/merged-problems.json", {
        next: { revalidate: 6 * 3600 },
      });
      const text = await up.text();
      return new NextResponse(text, {
        status: up.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=600",
        },
      });
    }
    if (type === "models") {
      const up = await fetch("https://kenkoooo.com/atcoder/resources/problem-models.json", {
        next: { revalidate: 6 * 3600 },
      });
      const text = await up.text();
      return new NextResponse(text, {
        status: up.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=600",
        },
      });
    }
    return NextResponse.json({ error: "bad type" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "upstream fetch failed" }, { status: 502 });
  }
}
