// Selected-row store for keyboard (e/r/h/d) and palette feedback actions.
// Client-side module state only (never in route handlers). Pages set the
// selection on row click; client-shell and the palette consume it.
import { db } from "./db";
import { recordFeedback } from "./skillContext";
import type { FeedbackRating } from "./db";

export interface Selection {
  problemKey: string;
  topicIds: string[];
  difficulty?: number;
  source: "recommendation" | "todo" | "nextRung" | "warmup" | "plan";
}

let current: Selection | null = null;
const listeners = new Set<(s: Selection | null) => void>();

export function getSelection(): Selection | null {
  return current;
}

export function setSelection(s: Selection | null): void {
  current = s;
  for (const fn of listeners) fn(s);
}

export function subscribeSelection(fn: (s: Selection | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export async function rateSelected(rating: FeedbackRating): Promise<boolean> {
  const s = current;
  if (!s) return false;
  await recordFeedback({
    problemKey: s.problemKey, rating, source: s.source,
    difficulty: s.difficulty, topicIds: s.topicIds,
  });
  return true;
}

export async function hideSelected(reason: "notInterested" | "tooHard" | "broken" | "other" = "notInterested"): Promise<boolean> {
  const s = current;
  if (!s) return false;
  const d = db();
  const prev = await d.hiddenProblems.where("problemKey").equals(s.problemKey).first();
  if (!prev) {
    await d.hiddenProblems.add({ problemKey: s.problemKey, reason, timestamp: Date.now() });
  }
  if (reason === "tooHard") {
    await recordFeedback({
      problemKey: s.problemKey, rating: "hard", source: s.source,
      difficulty: s.difficulty, topicIds: s.topicIds,
    });
  }
  return true;
}
