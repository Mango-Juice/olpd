import { listStageArchives } from "../game/archive";
import { loadSave, type StorageLike } from "../game/storage";
import type { SaveData, Settings } from "../game/types";
import { isStageId } from "./catalog";
import {
  completeVerifiedRun,
  createCampaignState,
  setActiveRun,
  updateCampaignSettings as setCampaignSettings,
  validateCampaignState,
  verifyRunCompletion,
  type CampaignProgressError,
  type CampaignRunReference,
  type CampaignStamp,
  type CampaignState,
  type RunCompletionAuthority,
} from "./progress";

export const CAMPAIGN_DATABASE = "one-line-per-death:campaign";
export const CAMPAIGN_DATABASE_VERSION = 1;
export const CAMPAIGN_STORE = "campaign";
const ROOT_KEY = "root";

export type CampaignRepositoryErrorCode =
  | "unavailable"
  | "blocked"
  | "read"
  | "write"
  | "corrupt"
  | "conflict"
  | "invalid-run"
  | "invalid-state";

export interface CampaignRepositoryError {
  code: CampaignRepositoryErrorCode;
  message: string;
  cause?: unknown;
}

export type CampaignRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CampaignRepositoryError };

interface StoredRun {
  reference: CampaignRunReference;
  payload: unknown;
}

interface StoredArchive extends StoredRun {
  completedAt: number;
}

/** One root record keeps progression, active runs, and archives in one IDB commit. */
interface CampaignDocument {
  state: CampaignState;
  activeRuns: StoredRun[];
  archives: StoredArchive[];
}

export interface CampaignRepositorySnapshot<Run> {
  state: CampaignState;
  activeRuns: { reference: CampaignRunReference; run: Run }[];
  archives: {
    reference: CampaignRunReference;
    completedAt: number;
    run: Run;
  }[];
}

export interface CampaignWriteOptions {
  /** Preferences accompanying a run are committed with that same atomic transition. */
  settings?: Settings;
  writer: string;
  expected: CampaignStamp;
}

export interface CampaignCompletionOptions extends CampaignWriteOptions {
  completedAt?: number;
}

export interface CampaignRepositoryOptions<Run extends object = object> {
  indexedDB?: IDBFactory | null;
  legacyStorage?: StorageLike | null;
  /** Converts a semantically valid v1 save into the repository's run union. */
  migrateLegacyRun?: (save: SaveData) => Run | null;
  /** null explicitly disables archive migration (useful outside a browser). */
  legacyArchiveReader?: (() => Promise<readonly SaveData[]>) | null;
  /** Test seam for exercising repository transactions without a browser. */
  documentStore?: CampaignDocumentStore;
}

export interface CampaignDocumentMutation<Result> {
  document: unknown;
  result: Result;
}

export interface CampaignDocumentStore {
  read(): Promise<CampaignRepositoryResult<unknown | null>>;
  mutate<Result>(
    transform: (
      current: unknown | null,
    ) => CampaignRepositoryResult<CampaignDocumentMutation<Result>>,
  ): Promise<CampaignRepositoryResult<Result>>;
}

function failure(
  code: CampaignRepositoryErrorCode,
  message: string,
  cause?: unknown,
): CampaignRepositoryResult<never> {
  return {
    ok: false,
    error: { code, message, ...(cause === undefined ? {} : { cause }) },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameReference(
  left: CampaignRunReference,
  right: CampaignRunReference,
): boolean {
  return left.runId === right.runId && left.stageId === right.stageId;
}

function validReference(value: unknown): value is CampaignRunReference {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    value.runId.trim().length > 0 &&
    isStageId(value.stageId)
  );
}

function sameStoredValue(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      left.getTime() === right.getTime()
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) =>
        sameStoredValue(item, right[index], seen),
      )
    );
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        sameStoredValue(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          seen,
        ),
    )
  );
}

function mapProgressError(
  error: CampaignProgressError,
): CampaignRepositoryResult<never> {
  return failure(
    error.code === "invalid-run" || error.code === "active-run-mismatch"
      ? "invalid-run"
      : "invalid-state",
    error.message,
  );
}

function defaultIndexedDB(): IDBFactory | null {
  try {
    return typeof indexedDB === "undefined" ? null : indexedDB;
  } catch {
    return null;
  }
}

class IndexedDbCampaignDocumentStore implements CampaignDocumentStore {
  constructor(private readonly factory: IDBFactory | null) {}

  private open(): Promise<CampaignRepositoryResult<IDBDatabase>> {
    const factory = this.factory;
    if (!factory) {
      return Promise.resolve(
        failure("unavailable", "이 브라우저에서는 캠페인을 저장할 수 없습니다."),
      );
    }
    return new Promise((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(
          CAMPAIGN_DATABASE,
          CAMPAIGN_DATABASE_VERSION,
        );
      } catch (cause) {
        resolve(failure("unavailable", "캠페인 저장소를 열지 못했습니다.", cause));
        return;
      }
      let settled = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(CAMPAIGN_STORE)) {
          request.result.createObjectStore(CAMPAIGN_STORE);
        }
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        resolve(
          failure(
            "blocked",
            "다른 창의 캠페인 저장소를 닫고 다시 시도해 주세요.",
          ),
        );
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        resolve(
          failure("unavailable", "캠페인 저장소를 열지 못했습니다.", request.error),
        );
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve({ ok: true, value: request.result });
      };
    });
  }

  async read(): Promise<CampaignRepositoryResult<unknown | null>> {
    const opened = await this.open();
    if (!opened.ok) return opened;
    const db = opened.value;
    try {
      return await new Promise((resolve) => {
        let transaction: IDBTransaction;
        try {
          transaction = db.transaction(CAMPAIGN_STORE, "readonly");
        } catch (cause) {
          resolve(failure("read", "캠페인 저장 상태를 읽지 못했습니다.", cause));
          return;
        }
        const request = transaction.objectStore(CAMPAIGN_STORE).get(ROOT_KEY);
        request.onsuccess = () =>
          resolve({ ok: true, value: request.result ?? null });
        request.onerror = () =>
          resolve(
            failure("read", "캠페인 저장 상태를 읽지 못했습니다.", request.error),
          );
        transaction.onabort = () =>
          resolve(
            failure(
              "read",
              "캠페인 저장 상태를 읽는 작업이 중단되었습니다.",
              transaction.error,
            ),
          );
      });
    } finally {
      db.close();
    }
  }

  async mutate<Result>(
    transform: (
      current: unknown | null,
    ) => CampaignRepositoryResult<CampaignDocumentMutation<Result>>,
  ): Promise<CampaignRepositoryResult<Result>> {
    const opened = await this.open();
    if (!opened.ok) return opened;
    const db = opened.value;
    try {
      return await new Promise<CampaignRepositoryResult<Result>>((resolve) => {
        let settled = false;
        let output: Result;
        let transaction: IDBTransaction;
        try {
          transaction = db.transaction(CAMPAIGN_STORE, "readwrite");
        } catch (cause) {
          resolve(failure("write", "캠페인 저장 작업을 시작하지 못했습니다.", cause));
          return;
        }
        const store = transaction.objectStore(CAMPAIGN_STORE);
        const request = store.get(ROOT_KEY);
        request.onerror = () => {
          if (settled) return;
          settled = true;
          resolve(
            failure("read", "기존 캠페인 상태를 읽지 못했습니다.", request.error),
          );
          transaction.abort();
        };
        request.onsuccess = () => {
          let mutation: CampaignRepositoryResult<
            CampaignDocumentMutation<Result>
          >;
          try {
            mutation = transform(request.result ?? null);
          } catch (cause) {
            settled = true;
            resolve(failure("write", "캠페인 저장 작업을 만들지 못했습니다.", cause));
            transaction.abort();
            return;
          }
          if (!mutation.ok) {
            settled = true;
            resolve(mutation);
            transaction.abort();
            return;
          }
          output = mutation.value.result;
          try {
            store.put(mutation.value.document, ROOT_KEY);
          } catch (cause) {
            settled = true;
            resolve(failure("write", "캠페인 상태를 저장하지 못했습니다.", cause));
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve({ ok: true, value: output });
        };
        transaction.onerror = () => {
          if (settled) return;
          settled = true;
          resolve(
            failure("write", "캠페인 상태를 저장하지 못했습니다.", transaction.error),
          );
        };
        transaction.onabort = () => {
          if (settled) return;
          settled = true;
          resolve(
            failure("write", "캠페인 저장 작업이 중단되었습니다.", transaction.error),
          );
        };
      });
    } finally {
      db.close();
    }
  }
}

/** IndexedDB-backed campaign repository with optimistic writer/revision checks. */
export class CampaignRepository<Run extends object> {
  private readonly store: CampaignDocumentStore;
  private readonly legacyStorage: StorageLike | null | undefined;
  private readonly migrateLegacyRun: ((save: SaveData) => Run | null) | undefined;
  private readonly legacyArchiveReader:
    | (() => Promise<readonly SaveData[]>)
    | null;

  constructor(
    private readonly authority: RunCompletionAuthority<Run>,
    options: CampaignRepositoryOptions<Run> = {},
  ) {
    this.store =
      options.documentStore ??
      new IndexedDbCampaignDocumentStore(
        options.indexedDB === undefined
          ? defaultIndexedDB()
          : options.indexedDB,
      );
    this.legacyStorage = options.legacyStorage;
    this.migrateLegacyRun = options.migrateLegacyRun;
    this.legacyArchiveReader =
      options.legacyArchiveReader === undefined
        ? async () => (await listStageArchives()).map(({ save }) => save)
        : options.legacyArchiveReader;
  }

  private parseStoredRun(
    payload: unknown,
  ): CampaignRepositoryResult<{
    run: Run;
    reference: CampaignRunReference;
  }> {
    try {
      const run = this.authority.parse(payload);
      const reference = run === null ? null : this.authority.describe(run);
      if (run === null || reference === null || !validReference(reference)) {
        return failure("corrupt", "저장된 실행 기록을 검증하지 못했습니다.");
      }
      return { ok: true, value: { run, reference } };
    } catch (cause) {
      return failure("corrupt", "저장된 실행 기록을 검증하지 못했습니다.", cause);
    }
  }

  private decodeDocument(
    value: unknown,
  ): CampaignRepositoryResult<CampaignRepositorySnapshot<Run>> {
    if (
      !isRecord(value) ||
      !Array.isArray(value.activeRuns) ||
      !Array.isArray(value.archives)
    ) {
      return failure("corrupt", "캠페인 저장 데이터의 구조가 올바르지 않습니다.");
    }
    const stateResult = validateCampaignState(value.state);
    if (!stateResult.ok) {
      return failure("corrupt", stateResult.error.message);
    }

    const activeRuns: CampaignRepositorySnapshot<Run>["activeRuns"] = [];
    for (const raw of value.activeRuns) {
      if (!isRecord(raw) || !isRecord(raw.reference)) {
        return failure("corrupt", "활성 실행 기록의 구조가 올바르지 않습니다.");
      }
      const parsed = this.parseStoredRun(raw.payload);
      if (!parsed.ok) return parsed;
      const { run, reference: described } = parsed.value;
      if (
        raw.reference.runId !== described.runId ||
        raw.reference.stageId !== described.stageId
      ) {
        return failure("corrupt", "활성 실행 기록을 검증하지 못했습니다.");
      }
      activeRuns.push({ reference: described, run });
    }

    const archives: CampaignRepositorySnapshot<Run>["archives"] = [];
    const storedRunIds = new Set(activeRuns.map(({ reference }) => reference.runId));
    for (const raw of value.archives) {
      if (
        !isRecord(raw) ||
        !isRecord(raw.reference) ||
        typeof raw.completedAt !== "number" ||
        !Number.isFinite(raw.completedAt) ||
        raw.completedAt < 0
      ) {
        return failure("corrupt", "완료 실행 기록의 구조가 올바르지 않습니다.");
      }
      const parsed = this.parseStoredRun(raw.payload);
      if (!parsed.ok) return parsed;
      const { run, reference: described } = parsed.value;
      let cleared: boolean;
      try {
        cleared = this.authority.isCleared(run);
      } catch (cause) {
        return failure("corrupt", "완료 실행 기록을 검증하지 못했습니다.", cause);
      }
      if (
        raw.reference.runId !== described.runId ||
        raw.reference.stageId !== described.stageId ||
        !cleared
      ) {
        return failure("corrupt", "완료 실행 기록을 검증하지 못했습니다.");
      }
      if (storedRunIds.has(described.runId)) {
        return failure("corrupt", "같은 실행 ID가 저장소에서 중복되었습니다.");
      }
      storedRunIds.add(described.runId);
      archives.push({ reference: described, completedAt: raw.completedAt, run });
    }

    const expectedActive = stateResult.value.stages
      .map((stage) => stage.activeRun)
      .filter((reference): reference is CampaignRunReference => reference !== null);
    const campaignCompletions = stateResult.value.stages
      .map((stage) =>
        stage.completion?.source === "campaign" ? stage.completion : null,
      )
      .filter((completion) => completion !== null);
    const referencesMatch = (
      expected: CampaignRunReference[],
      actual: CampaignRunReference[],
    ) =>
      expected.length === actual.length &&
      expected.every((reference) =>
        actual.some((candidate) => sameReference(reference, candidate)),
      );
    if (
      !referencesMatch(
        expectedActive,
        activeRuns.map(({ reference }) => reference),
      ) ||
      !campaignCompletions.every((completion) =>
        archives.some(
          (archive) =>
            sameReference(completion.run, archive.reference) &&
            completion.completedAt === archive.completedAt,
        ),
      ) ||
      archives.some(
        (archive) =>
          stateResult.value.stages[archive.reference.stageId - 1].status !==
          "completed",
      )
    ) {
      return failure("corrupt", "캠페인 진행 상태와 실행 기록이 서로 맞지 않습니다.");
    }

    return {
      ok: true,
      value: { state: stateResult.value, activeRuns, archives },
    };
  }

  private documentFromSnapshot(
    snapshot: CampaignRepositorySnapshot<Run>,
  ): CampaignDocument {
    return {
      state: snapshot.state,
      activeRuns: snapshot.activeRuns.map(({ reference, run }) => ({
        reference,
        payload: this.authority.serialize(run),
      })),
      archives: snapshot.archives.map(({ reference, completedAt, run }) => ({
        reference,
        completedAt,
        payload: this.authority.serialize(run),
      })),
    };
  }

  private mapLegacySave(
    save: SaveData,
    requireCleared: boolean,
  ): CampaignRepositoryResult<{
    run: Run;
    reference: CampaignRunReference;
    payload: unknown;
    cleared: boolean;
  }> {
    if (!this.migrateLegacyRun) {
      return failure(
        "invalid-run",
        "레거시 실행을 옮길 변환기가 없어 기존 기록을 그대로 보존했습니다.",
      );
    }
    try {
      const mapped = this.migrateLegacyRun(save);
      if (mapped === null || mapped === undefined) {
        return failure("invalid-run", "레거시 실행을 현재 형식으로 변환하지 못했습니다.");
      }
      const payload = this.authority.serialize(mapped);
      const run = this.authority.parse(payload);
      const reference = run === null ? null : this.authority.describe(run);
      const cleared = run !== null && this.authority.isCleared(run);
      if (
        run === null ||
        reference === null ||
        !validReference(reference) ||
        reference.stageId !== 1 ||
        reference.runId !== save.state.id ||
        (requireCleared && !cleared)
      ) {
        return failure("invalid-run", "레거시 실행의 의미 검증에 실패했습니다.");
      }
      return { ok: true, value: { run, reference, payload, cleared } };
    } catch (cause) {
      return failure(
        "invalid-run",
        "레거시 실행을 현재 형식으로 검증하지 못했습니다.",
        cause,
      );
    }
  }

  private async initialSnapshot(
    writer: string,
  ): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    let currentSave: SaveData | null = null;
    if (this.legacyStorage !== null) {
      const loaded = loadSave(this.legacyStorage);
      if (!loaded.ok) {
        return failure(
          loaded.error.code === "read" ? "read" : "corrupt",
          loaded.error.message,
          loaded.error.cause,
        );
      }
      currentSave = loaded.value;
    }

    let legacyArchives: readonly SaveData[] = [];
    if (this.legacyArchiveReader !== null) {
      try {
        legacyArchives = await this.legacyArchiveReader();
        if (!Array.isArray(legacyArchives)) {
          return failure("corrupt", "기존 모험 보관함 응답이 올바르지 않습니다.");
        }
      } catch (cause) {
        return failure(
          "read",
          "기존 모험 보관함을 모두 읽지 못해 마이그레이션하지 않았습니다.",
          cause,
        );
      }
    }

    const applicableCurrent = currentSave;
    if (applicableCurrent === null && legacyArchives.length === 0) {
      try {
        return {
          ok: true,
          value: {
            state: createCampaignState(writer),
            activeRuns: [],
            archives: [],
          },
        };
      } catch (cause) {
        return failure("invalid-state", "새 캠페인 상태를 만들지 못했습니다.", cause);
      }
    }

    const archives: (CampaignRepositorySnapshot<Run>["archives"][number] & {
      payload: unknown;
    })[] = [];
    const addArchive = (
      mapped: {
        run: Run;
        reference: CampaignRunReference;
        payload: unknown;
      },
      completedAt: number,
    ): CampaignRepositoryResult<void> => {
      const duplicate = archives.find(
        (item) => item.reference.runId === mapped.reference.runId,
      );
      if (duplicate) {
        if (
          duplicate.reference.stageId !== mapped.reference.stageId ||
          duplicate.completedAt !== completedAt ||
          !sameStoredValue(duplicate.payload, mapped.payload)
        ) {
          return failure(
            "conflict",
            "같은 ID의 레거시 완료 기록 내용이 서로 달라 마이그레이션하지 않았습니다.",
          );
        }
        return { ok: true, value: undefined };
      }
      archives.push({ ...mapped, completedAt });
      return { ok: true, value: undefined };
    };

    for (const save of legacyArchives) {
      const mapped = this.mapLegacySave(save, true);
      if (!mapped.ok) return mapped;
      const added = addArchive(mapped.value, save.savedAt);
      if (!added.ok) return added;
    }

    let activeRun: CampaignRepositorySnapshot<Run>["activeRuns"][number] | null =
      null;
    let currentCompletion: CampaignRunReference | null = null;
    if (applicableCurrent !== null) {
      const mapped = this.mapLegacySave(applicableCurrent, false);
      if (!mapped.ok) return mapped;
      if (mapped.value.cleared) {
        const added = addArchive(mapped.value, applicableCurrent.savedAt);
        if (!added.ok) return added;
        currentCompletion = mapped.value.reference;
      } else {
        if (
          archives.some(
            (item) => item.reference.runId === mapped.value.reference.runId,
          )
        ) {
          return failure(
            "conflict",
            "진행 중인 레거시 실행 ID가 완료 보관 기록과 겹칩니다.",
          );
        }
        activeRun = { reference: mapped.value.reference, run: mapped.value.run };
      }
    }

    const canonical =
      currentCompletion === null
        ? archives[0] ?? null
        : archives.find((item) => sameReference(item.reference, currentCompletion));
    if (currentCompletion !== null && canonical === undefined) {
      return failure("conflict", "현재 완료 실행을 보관 기록에서 확인하지 못했습니다.");
    }
    let state: CampaignState;
    try {
      const fresh = createCampaignState(writer);
      const latestArchive = legacyArchives.reduce<SaveData | null>(
        (latest, save) =>
          latest === null || save.savedAt > latest.savedAt ? save : latest,
        null,
      );
      const migratedSettings = currentSave?.settings ?? latestArchive?.settings ?? null;
      state = {
        ...fresh,
        settings: migratedSettings
          ? {
              muted: migratedSettings.muted,
              reducedMotion: migratedSettings.reducedMotion,
            }
          : null,
        stages: fresh.stages.map((stage) => {
          if (stage.stageId === 1) {
            return {
              ...stage,
              status: canonical ? "completed" : "unlocked",
              activeRun: activeRun?.reference ?? null,
              completion: canonical
                ? {
                    run: canonical.reference,
                    completedAt: canonical.completedAt,
                    source: "legacy",
                  }
                : null,
            };
          }
          return stage.stageId === 2 && canonical
            ? { ...stage, status: "unlocked" }
            : stage;
        }),
      };
    } catch (cause) {
      return failure("invalid-state", "새 캠페인 상태를 만들지 못했습니다.", cause);
    }
    const validated = validateCampaignState(state);
    if (!validated.ok) return failure("invalid-state", validated.error.message);
    return {
      ok: true,
      value: {
        state: validated.value,
        activeRuns: activeRun ? [activeRun] : [],
        archives: archives.map(({ reference, run, completedAt }) => ({
          reference,
          run,
          completedAt,
        })),
      },
    };
  }

  private checkExpected(
    state: CampaignState,
    expected: CampaignStamp,
  ): CampaignRepositoryResult<CampaignState> {
    if (
      state.writer !== expected.writer ||
      state.revision !== expected.revision
    ) {
      return failure(
        "conflict",
        "다른 창에서 캠페인이 변경되어 현재 작업을 저장하지 않았습니다.",
      );
    }
    return { ok: true, value: state };
  }

  async loadOrCreate(
    writer: string,
  ): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    const read = await this.store.read();
    if (!read.ok) return read;
    if (read.value !== null) return this.decodeDocument(read.value);

    const prepared = await this.initialSnapshot(writer);
    if (!prepared.ok) return prepared;
    const initial = this.documentFromSnapshot(prepared.value);
    const created = await this.store.mutate((current) => {
      if (current !== null) {
        const decoded = this.decodeDocument(current);
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          value: { document: current, result: decoded.value },
        };
      }
      const decoded = this.decodeDocument(initial);
      if (!decoded.ok) return decoded;
      return {
        ok: true,
        value: { document: initial, result: decoded.value },
      };
    });
    if (!created.ok) return created;
    const reread = await this.store.read();
    if (!reread.ok) return reread;
    if (reread.value === null) {
      return failure("write", "저장한 캠페인 상태를 다시 확인하지 못했습니다.");
    }
    return this.decodeDocument(reread.value);
  }

  async load(): Promise<
    CampaignRepositoryResult<CampaignRepositorySnapshot<Run> | null>
  > {
    const read = await this.store.read();
    if (!read.ok) return read;
    if (read.value === null) return { ok: true, value: null };
    return this.decodeDocument(read.value);
  }

  async saveActiveRun(
    run: Run,
    options: CampaignWriteOptions,
  ): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    let payload: unknown;
    let parsed: Run | null;
    let reference: CampaignRunReference | null;
    try {
      payload = this.authority.serialize(run);
      parsed = this.authority.parse(payload);
      reference = parsed === null ? null : this.authority.describe(parsed);
    } catch (cause) {
      return failure("invalid-run", "실행 기록을 검증하지 못했습니다.", cause);
    }
    if (parsed === null || reference === null) {
      return failure("invalid-run", "유효한 실행 기록이 아닙니다.");
    }
    const storedRun = parsed;
    const storedReference = reference;

    const saved = await this.store.mutate((current) => {
      if (current === null) {
        return failure("invalid-state", "저장할 캠페인 상태가 없습니다.");
      }
      const decoded = this.decodeDocument(current);
      if (!decoded.ok) return decoded;
      const expected = this.checkExpected(decoded.value.state, options.expected);
      if (!expected.ok) return expected;
      const nextState = setActiveRun(
        decoded.value.state,
        storedReference,
        options.writer,
      );
      if (!nextState.ok) return mapProgressError(nextState.error);
      if (options.settings !== undefined) {
        const withSettings = validateCampaignState({ ...nextState.value, settings: options.settings });
        if (!withSettings.ok) return mapProgressError(withSettings.error);
        nextState.value = withSettings.value;
      }
      if (
        decoded.value.archives.some(
          (archive) => archive.reference.runId === storedReference.runId,
        )
      ) {
        return failure("invalid-run", "이미 보관된 실행 ID는 다시 사용할 수 없습니다.");
      }

      const next: CampaignRepositorySnapshot<Run> = {
        ...decoded.value,
        state: nextState.value,
        activeRuns: [
          ...decoded.value.activeRuns.filter(
            (item) => item.reference.stageId !== storedReference.stageId,
          ),
          { reference: storedReference, run: storedRun },
        ],
      };
      const document = this.documentFromSnapshot(next);
      document.activeRuns = document.activeRuns.map((item) =>
        sameReference(item.reference, storedReference)
          ? { ...item, payload }
          : item,
      );
      return {
        ok: true,
        value: {
          document,
          result: next,
        },
      };
    });
    if (!saved.ok) return saved;
    return { ok: true, value: saved.value };
  }

  async updateSettings(
    settings: Settings,
    options: CampaignWriteOptions,
  ): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    const saved = await this.store.mutate((current) => {
      if (current === null) {
        return failure("invalid-state", "설정을 저장할 캠페인 상태가 없습니다.");
      }
      const decoded = this.decodeDocument(current);
      if (!decoded.ok) return decoded;
      const expected = this.checkExpected(decoded.value.state, options.expected);
      if (!expected.ok) return expected;
      const nextState = setCampaignSettings(
        decoded.value.state,
        settings,
        options.writer,
      );
      if (!nextState.ok) return mapProgressError(nextState.error);
      if (options.settings !== undefined) {
        const withSettings = validateCampaignState({ ...nextState.value, settings: options.settings });
        if (!withSettings.ok) return mapProgressError(withSettings.error);
        nextState.value = withSettings.value;
      }
      const next: CampaignRepositorySnapshot<Run> = {
        ...decoded.value,
        state: nextState.value,
      };
      return {
        ok: true,
        value: { document: this.documentFromSnapshot(next), result: next },
      };
    });
    if (!saved.ok) return saved;
    return { ok: true, value: saved.value };
  }

  async completeActiveRun(
    run: Run,
    options: CampaignCompletionOptions,
  ): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    const verified = verifyRunCompletion(run, this.authority);
    if (!verified.ok) return mapProgressError(verified.error);
    const completedAt = options.completedAt ?? Date.now();

    const saved = await this.store.mutate((current) => {
      if (current === null) {
        return failure("invalid-state", "완료할 캠페인 상태가 없습니다.");
      }
      const decoded = this.decodeDocument(current);
      if (!decoded.ok) return decoded;
      const expected = this.checkExpected(decoded.value.state, options.expected);
      if (!expected.ok) return expected;
      const nextState = completeVerifiedRun(
        decoded.value.state,
        verified.value,
        options.writer,
        completedAt,
      );
      if (!nextState.ok) return mapProgressError(nextState.error);
      if (options.settings !== undefined) {
        const withSettings = validateCampaignState({ ...nextState.value, settings: options.settings });
        if (!withSettings.ok) return mapProgressError(withSettings.error);
        nextState.value = withSettings.value;
      }

      const next: CampaignRepositorySnapshot<Run> = {
        state: nextState.value,
        activeRuns: decoded.value.activeRuns.filter(
          (item) => item.reference.stageId !== verified.value.reference.stageId,
        ),
        archives: [
          ...decoded.value.archives,
          {
            reference: verified.value.reference,
            completedAt,
            run: verified.value.run,
          },
        ],
      };
      const document = this.documentFromSnapshot(next);
      const archived = document.archives.find((item) =>
        sameReference(item.reference, verified.value.reference),
      );
      if (archived) archived.payload = verified.value.serialized;
      return { ok: true, value: { document, result: next } };
    });
    if (!saved.ok) return saved;
    return { ok: true, value: saved.value };
  }
}
