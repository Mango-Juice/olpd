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

export function stageArchive(save: SaveData): StageArchive {
  return {
    id: save.state.id,
    stageId: "memory-dungeon",
    title: "첫 번째 여정 · 기억의 던전",
    completedAt: save.savedAt,
    save,
  };
}

/** A completed run is written once, outside the frequently rewritten active save. */
export async function archiveStage(save: SaveData): Promise<void> {
  if (save.state.phase !== "cleared" || save.state.tutorial) return;
  const db = await openArchive();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const existing = store.get(save.state.id);
      existing.onsuccess = () => {
        if (!existing.result) store.add(stageArchive(save));
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
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
