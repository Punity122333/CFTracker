// Mistake-log patterns. Pure functions; constants live in tuning.ts.
// Checklists and topic mappings are static data (JSON imports).
import {
  MISTAKE_DOMINANT_SHARE,
  MISTAKE_MIN_COUNT,
  MISTAKE_WINDOW_DAYS,
} from "./tuning";
import checklists from "../data/mistakeChecklists.json";
import topicMap from "../data/mistakeTopics.json";

export interface Mistake {
  category: string;
  timestamp: number;
}

export interface MistakeStats {
  counts: Record<string, number>;
  total: number;
  dominant: string | null;
  share: number;
}

export function mistakeStats(mistakes: Mistake[], nowMs: number): MistakeStats {
  const cutoff = nowMs - MISTAKE_WINDOW_DAYS * 86400000;
  const counts: Record<string, number> = {};
  let total = 0;
  for (const m of mistakes) {
    if (m.timestamp < cutoff) continue;
    counts[m.category] = (counts[m.category] ?? 0) + 1;
    total++;
  }
  let dominant: string | null = null;
  let best = 0;
  for (const [cat, n] of Object.entries(counts)) {
    if (n > best) {
      best = n;
      dominant = cat;
    }
  }
  const share = total > 0 && dominant ? (counts[dominant] ?? 0) / total : 0;
  const qualifies =
    dominant != null && share >= MISTAKE_DOMINANT_SHARE && (counts[dominant] ?? 0) >= MISTAKE_MIN_COUNT;
  return { counts, total, dominant: qualifies ? dominant : null, share };
}

export function checklistFor(category: string): string[] {
  const all = checklists as Record<string, string[]>;
  return all[category] ?? [];
}

export function topicsForMistake(category: string): string[] {
  const all = topicMap as Record<string, string[]>;
  return all[category] ?? [];
}
