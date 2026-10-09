import { NextRequest, NextResponse } from "next/server";

// Best-effort CSES solved-list import from the public user page.
// CSES has no official API; manual marking is the primary path.
// If this is flaky/blocked, the UI falls back to manual and this route
// may be removed (see README).
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = req.nextUrl.searchParams.get("user") ?? "";
  if (!user) return NextResponse.json({ ok: false, reason: "no user" });
  try {
    // Public profile pages on cses.fi are not a stable API; try a couple
    // of known shapes and give up cleanly.
    const candidates = [
      `https://cses.fi/user/${encodeURIComponent(user)}`,
    ];
    for (const url of candidates) {
      const up = await fetch(url, { next: { revalidate: 600 } });
      if (!up.ok) continue;
      const html = await up.text();
      const re = /\/problemset\/task\/(\d+)/g;
      const ids: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) ids.push(m[1]);
      if (ids.length > 0) {
        return NextResponse.json(
          { ok: true, solved: [...new Set(ids)] },
          { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=120" } }
        );
      }
    }
    return NextResponse.json({ ok: false, reason: "could not parse user page" });
  } catch {
    return NextResponse.json({ ok: false, reason: "fetch failed" }, { status: 502 });
  }
}
