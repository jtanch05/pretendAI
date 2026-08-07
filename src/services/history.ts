import Dexie, { type EntityTable } from "dexie";

export type WaitingHistoryEntry = {
  id?: number;
  questionId: string;
  role: "asker";
  questionText: string;
  status: "pending" | "reserved";
  createdAt: string;
  lastSyncedAt: string;
};

const database = new Dexie("pretend-ai") as Dexie & {
  historyEntries: EntityTable<WaitingHistoryEntry, "id">;
};

database.version(1).stores({
  historyEntries: "++id, questionId, status, createdAt"
});

export const history = {
  async saveWaitingQuestion(entry: Omit<WaitingHistoryEntry, "id" | "lastSyncedAt">) {
    await database.historyEntries.put({ ...entry, lastSyncedAt: new Date().toISOString() });
  }
};
