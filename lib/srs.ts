// Spaced repetition: reviews at 3, 14 and 30 days after Understood is ticked.

export const REVIEW_OFFSETS_DAYS = [3, 14, 30] as const;

export function scheduleReviews(understoodAt: number): number[] {
  const day = 24 * 60 * 60 * 1000;
  return REVIEW_OFFSETS_DAYS.map((d) => understoodAt + d * day);
}

export function nextDue(dueDates: number[], nowMs: number): number | null {
  const upcoming = dueDates.filter((d) => d > nowMs).sort((a, b) => a - b);
  if (upcoming.length > 0) return upcoming[0];
  const past = dueDates.filter((d) => d <= nowMs).sort((a, b) => a - b);
  return past.length > 0 ? past[0] : null;
}

export function isOverdue(dueDates: number[], nowMs: number): boolean {
  return dueDates.some((d) => d <= nowMs);
}

// Upsolve section ordering: items with a review currently due resurface
// first (the set intervals), the rest keep todo insertion order.
export function upsolveFirst<T extends { problemKey: string }>(
  items: T[],
  dueKeys: Set<string>
): T[] {
  return [...items].sort(
    (a, b) => Number(dueKeys.has(b.problemKey)) - Number(dueKeys.has(a.problemKey))
  );
}
