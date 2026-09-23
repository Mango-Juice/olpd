import { loadSave } from "./storage";
import type { SaveData } from "./types";

export interface StageArchive {
  id: string;
  stageId: string;
  title: string;
  completedAt: number;
  save: SaveData;
}

const DATABASE = "one-line-per-death:chronicles";
const STORE = "stages";

function openArchive(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("이 브라우저에서는 모험 기록을 보관할 수 없어요."));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("다른 창의 기록 보관함을 닫고 다시 시도해 주세요."));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

export async function listStageArchives(): Promise<StageArchive[]> {
  const db = await openArchive();
  try {
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const request = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return records
      .map((value) => {
        const record = value as Partial<StageArchive> | null;
        if (
          !record ||
          typeof record.id !== "string" ||
          typeof record.title !== "string" ||
          typeof record.stageId !== "string" ||
          !Number.isFinite(record.completedAt)
        ) {
          throw new Error(
            "보관된 모험 기록을 읽지 못했어요. 원본은 그대로 남아 있어요.",
          );
        }
        const loaded = loadSave({
          getItem: () => JSON.stringify(record.save),
          setItem: () => undefined,
        });
        if (
          !loaded.ok ||
          !loaded.value ||
          loaded.value.state.id !== record.id ||
          loaded.value.state.phase !== "cleared" ||
          loaded.value.state.tutorial
        ) {
          throw new Error(
            "현재 버전에서 읽을 수 없는 모험 기록이 있어요. 원본은 그대로 남아 있어요.",
          );
        }
        return { ...record, save: loaded.value } as StageArchive;
      })
      .sort((a, b) => b.completedAt - a.completedAt);
  } finally {
    db.close();
  }
}

/** Remove only entries whose exact bytes were summarized by a durable campaign root. */
export async function clearStageArchives(summarized: readonly StageArchive[]): Promise<void> {
  if (summarized.length === 0) return;
  const db = await openArchive();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const archived of summarized) {
        const request = store.get(archived.id);
        request.onsuccess = () => {
          const current = request.result as StageArchive | undefined;
          if (current && current.completedAt === archived.completedAt &&
            JSON.stringify(current.save) === JSON.stringify(archived.save)) store.delete(archived.id);
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
