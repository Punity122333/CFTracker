// Manual script: request every URL generated from data/topics.json,
// report any that do not return 2xx. Run with `npm run check-links`.
// Never fails the Vercel build (manual only).
import topics from "../data/topics.json";

interface Topic {
  id: string;
  resources: { label: string; url: string }[];
}

async function check(url: string): Promise<number | string> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (res.status === 405 || res.status === 403) {
      const g = await fetch(url, { method: "GET", redirect: "follow" });
      return g.status;
    }
    return res.status;
  } catch (e) {
    return String(e);
  }
}

async function main() {
  const list = (topics as { topics: Topic[] }).topics;
  let dead = 0;
  for (const t of list) {
    for (const r of t.resources) {
      const status = await check(r.url);
      const ok = typeof status === "number" && status >= 200 && status < 300;
      console.log(`${ok ? "ok  " : "DEAD"} ${status} ${t.id} ${r.url}`);
      if (!ok) dead++;
      await new Promise((r2) => setTimeout(r2, 300));
    }
  }
  console.log(`done: ${dead} dead links`);
}

main();
