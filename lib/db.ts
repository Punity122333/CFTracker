// Dexie schema. All user data lives in IndexedDB. No backend database.
// Client-only: import dynamically from client components.

import Dexie, { type Table } from "dexie";

export const EXPORT_VERSION = 3;

export interface ProblemRow {
  key: string; // platform:id
  platform: "codeforces" | "cses" | "atcoder";
  pid: string;
  title: string;
  difficulty?: number;
  tags: string[];
  url: string;
  updatedAt: number;
  solvedCount?: number; // Phase 5: cf problemStatistics solvedCount (popularity prior)
}

export interface SubmissionRow {
  id?: number;
  platform: "codeforces" | "cses" | "atcoder";
  problemKey: string;
  verdict: string;
  language?: string;
  timestamp: number;
  contestId?: number;
  submissionId?: string;
}

export interface TodoItem {
  id?: number;
  problemKey: string;
  solved: boolean;
  implemented: boolean;
  understood: boolean;
  solvedWithoutHelp: boolean;
  stuck: boolean;
  hintLevelUsed: number; // 0-3
  logic: string;
  acceptedCode: string;
  keyTrick: string;
  selfCheck: { observation: boolean; complexity: boolean; edgeCases: boolean };
  timerSeconds: number;
  addedAt: number;
  understoodAt?: number;
  qualityOverride?: string; // Phase 6: user-corrected solve quality level
  done?: boolean; // moved to the done section by the user
  doneAt?: number;
  upsolve?: boolean; // flagged for upsolve: shows in the upsolve section + contests upsolve
}

export interface MistakeRow {
  id?: number;
  problemKey: string;
  category: string;
  note: string;
  timestamp: number;
}

export interface ReviewRow {
  id?: number;
  problemKey: string;
  dueDates: number[];
  history: number[];
}

export interface ListRow {
  id?: number;
  name: string;
  problemKeys: string[];
}

export interface ManualTagRow {
  id?: number;
  problemKey: string;
  tags: string[];
}

export interface TopicStateRow {
  id?: number;
  topicId: string;
  statusOverride?: string;
  skipped: boolean;
  note: string;
  userResources: { label: string; url: string }[];
  comfortRating?: number; // Phase 5: manual per-topic ability override (clamped)
  targetOffset?: number; // Phase 5: adaptive ramp offset for this topic
  streak?: number; // Phase 5: consecutive unaided (+) / failures (-) near target
  offsetWeek?: string; // Phase 6: ISO week key of feedback drift accumulation
  offsetWeekDrift?: number; // Phase 6: feedback offset movement used up this week
}

export interface SnippetRow {
  id?: number;
  title: string;
  tags: string[];
  code: string;
}

export interface SettingsRow {
  id?: number;
  cfHandle: string;
  atcoderHandle: string;
  csesUser: string;
  difficultyLow: number;
  difficultyHigh: number;
  weeklyGoal: number;
  stuckTimeoutMinutes: number;
  lastExportAt?: number;
  comfortRating?: number; // Phase 5: "my comfortable level", overrides the estimate
  cfRating?: number; // last synced Codeforces contest rating
  cfMaxRating?: number; // max Codeforces contest rating seen
  showNextRungs?: boolean; // Phase 6: show next rungs after solve (default on)
  warmupMinutes?: number; // Phase 6: warmup countdown length (default 30)
  cfContestWindows?: Record<string, number>; // Phase 6: contestId -> rating-update time (in-contest evidence)
}

export interface TrainerStatsRow {
  id?: number;
  algoId: string;
  mode: "write" | "blank" | "order";
  attempts: number;
  correct: number;
  box: number; // Leitner box 1-5
  dueAt: number;
  lastSeenAt: number;
  lastResult: "correct" | "partly" | "wrong" | null;
}

export type FeedbackRating = "easy" | "right" | "hard";
export type FeedbackSource = "recommendation" | "todo" | "nextRung" | "warmup" | "plan";

export interface FeedbackRow {
  id?: number;
  problemKey: string;
  topicIds: string[];
  difficulty?: number;
  rating: FeedbackRating;
  source: FeedbackSource;
  timestamp: number;
}

export type HiddenReason = "notInterested" | "tooHard" | "broken" | "other";

export interface HiddenProblemRow {
  id?: number;
  problemKey: string;
  reason: HiddenReason;
  timestamp: number;
}

export type PlanItemKind =
  | "weak" | "new-topic-read" | "new-topic-practice" | "review"
  | "trainer" | "stretch" | "revisit" | "warmup";

export interface PlanItem {
  id: string;
  day: number; // 0-6 from weekStart
  kind: PlanItemKind;
  ref: string; // problemKey | topicId | algoId | contest label
  title: string;
  done: boolean;
  doneAt?: number;
  reason?: string; // one-line why, from the ranker or generator
}

export interface PlanRow {
  id?: number;
  weekStart: string; // ISO date
  items: PlanItem[];
}

export interface WarmupRow {
  id?: number;
  startedAt: number;
  problemKeys: string[];
  solvedKeys: string[];
  durationSec: number;
}

export interface AbilitySnapshotRow {
  id?: number;
  date: string; // ISO date, one per day
  globalTheta: number;
  topicThetas: Record<string, number>;
  source: "auto" | "manual";
}

export interface SyncMetaRow {
  id?: number;
  platform: string;
  lastSyncAt: number;
  lastSubmissionId?: string;
}

export class TrackerDB extends Dexie {
  problems!: Table<ProblemRow, string>;
  submissions!: Table<SubmissionRow, number>;
  todoItems!: Table<TodoItem, number>;
  mistakes!: Table<MistakeRow, number>;
  reviews!: Table<ReviewRow, number>;
  lists!: Table<ListRow, number>;
  manualTags!: Table<ManualTagRow, number>;
  topicState!: Table<TopicStateRow, number>;
  trainerStats!: Table<TrainerStatsRow, number>;
  feedback!: Table<FeedbackRow, number>;
  hiddenProblems!: Table<HiddenProblemRow, number>;
  plans!: Table<PlanRow, number>;
  warmups!: Table<WarmupRow, number>;
  abilitySnapshots!: Table<AbilitySnapshotRow, number>;
  snippets!: Table<SnippetRow, number>;
  settings!: Table<SettingsRow, number>;
  syncMeta!: Table<SyncMetaRow, number>;

  constructor() {
    super("cftracker");
    this.version(1).stores({
      problems: "key, platform, difficulty",
      submissions: "++id, platform, problemKey, timestamp",
      todoItems: "++id, problemKey, stuck",
      mistakes: "++id, problemKey, timestamp",
      reviews: "++id, problemKey",
      lists: "++id, name",
      manualTags: "++id, problemKey",
      topicState: "++id, topicId",
      snippets: "++id, title",
      settings: "++id",
      syncMeta: "++id, platform",
    });
    // v2: index submissionId + contestId for incremental sync dedupe
    // and contest-based upsolve queries. Auto-upgrades from v1.
    this.version(2).stores({
      submissions: "++id, platform, problemKey, timestamp, submissionId, contestId",
    });
    // v3: Phase 5 Leitner trainer stats. Auto-upgrades from v1/v2.
    this.version(3).stores({
      trainerStats: "++id, algoId, mode, dueAt",
    });
    // v4: Phase 6 self-correction + planning tables. Auto-upgrades.
    this.version(4).stores({
      feedback: "++id, problemKey, timestamp",
      hiddenProblems: "++id, problemKey",
      plans: "++id, weekStart",
      warmups: "++id, startedAt",
      abilitySnapshots: "++id, date",
    });
  }
}

let _db: TrackerDB | null = null;

export function db(): TrackerDB {
  if (typeof window === "undefined" && typeof indexedDB === "undefined") {
    throw new Error("db() is client-only");
  }
  if (!_db) _db = new TrackerDB();
  return _db;
}

export async function getSettings(): Promise<SettingsRow> {
  const d = db();
  const existing = await d.settings.toCollection().first();
  if (existing) return existing;
  const defaults: SettingsRow = {
    cfHandle: "",
    atcoderHandle: "",
    csesUser: "",
    difficultyLow: 0,
    difficultyHigh: 300,
    weeklyGoal: 5,
    stuckTimeoutMinutes: 45,
  };
  const id = await d.settings.add(defaults);
  return { ...defaults, id };
}

export async function saveSettings(patch: Partial<SettingsRow>): Promise<SettingsRow> {
  const d = db();
  const cur = await getSettings();
  await d.settings.update(cur.id!, { ...patch });
  return { ...cur, ...patch };
}
