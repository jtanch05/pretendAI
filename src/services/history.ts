import Dexie, { type EntityTable } from "dexie";

export type WaitingHistoryEntry = {
  id?: number;
  questionId: string;
  role: "asker" | "answerer";
  questionText: string;
  status: "pending" | "reserved" | "delivered";
  createdAt: string;
  lastSyncedAt: string;
  answerId?: string;
  answerText?: string;
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
  },
  async saveSubmittedAnswer(entry: Omit<WaitingHistoryEntry, "id" | "lastSyncedAt" | "status">) {
    await database.historyEntries.put({ ...entry, status: "reserved", lastSyncedAt: new Date().toISOString() });
  },
  async saveDeliveredAnswer(entry: Omit<WaitingHistoryEntry, "id" | "lastSyncedAt" | "status">) {
    await database.historyEntries.put({ ...entry, status: "delivered", lastSyncedAt: new Date().toISOString() });
  }
};
