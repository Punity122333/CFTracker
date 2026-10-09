import { db, EXPORT_VERSION } from "./db";

export interface ExportBlob {
  version: number;
  exportedAt: number;
  tables: Record<string, unknown[]>;
}

const TABLES = [
  "problems",
  "submissions",
  "todoItems",
  "mistakes",
  "reviews",
  "lists",
  "manualTags",
  "topicState",
  "snippets",
  "settings",
  "syncMeta",
  "trainerStats",
  "feedback",
  "hiddenProblems",
  "plans",
  "warmups",
  "abilitySnapshots",
] as const;

export async function exportAll(): Promise<ExportBlob> {
  const d = db();
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    tables[t] = await d.table(t).toArray();
  }
  return { version: EXPORT_VERSION, exportedAt: Date.now(), tables };
}

export async function importAll(blob: ExportBlob): Promise<void> {
  if (typeof blob.version !== "number" || !blob.tables) {
    throw new Error("bad import file");
  }
  // migration path: v1 lacks trainerStats (export v2), v1/v2 lack the
  // Phase 6 tables (export v3). Older blobs upgrade by defaulting
  // missing tables to [].
  if (blob.version > EXPORT_VERSION) {
    throw new Error(`unsupported export version ${blob.version}`);
  }
  const d = db();
  await d.transaction(
    "rw",
    d.tables,
    async () => {
      for (const t of TABLES) {
        const rows = (blob.tables[t] ?? []) as Record<string, unknown>[];
        await d.table(t).clear();
        if (rows.length > 0) {
          // strip auto-increment ids so fresh profile reproduces data
          await d.table(t).bulkAdd(rows);
        }
      }
    }
  );
}
