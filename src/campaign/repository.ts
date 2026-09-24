import { clearStageArchives, listStageArchives } from "../game/archive";
import { loadSave, STORAGE_KEY, type StorageLike } from "../game/storage";
import type { SaveData, Settings } from "../game/types";
import { isStageId } from "./catalog";
import { parseStageRun } from "./run-validation";
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
const CAMPAIGN_DOCUMENT_VERSION = 5 as const;
const PREVIOUS_DOCUMENT_VERSION = 4 as const;

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

export interface CampaignRecoveryRecord {
  kind: "active";
  reference: CampaignRunReference;
  payload: unknown;
  recoveredAt: number;
}

interface PreviousRecoveryRecord extends Omit<CampaignRecoveryRecord, "kind"> {
  kind: "active" | "archive";
  completedAt?: number;
}

/** One root record keeps progression and active runs in one IDB commit. */
interface CampaignDocument {
  version: typeof CAMPAIGN_DOCUMENT_VERSION;
  state: CampaignState;
  activeRuns: StoredRun[];
  recoveries: CampaignRecoveryRecord[];
}

interface PreviousCampaignDocument extends Omit<CampaignDocument, "version" | "recoveries"> {
  version: typeof PREVIOUS_DOCUMENT_VERSION;
  archives: StoredArchive[];
  recoveries: PreviousRecoveryRecord[];
}

export interface CampaignRepositorySnapshot<Run> {
  state: CampaignState;
  activeRuns: { reference: CampaignRunReference; run: Run }[];
  /** Raw runs from retired content retained outside the current playable campaign. */
  recoveries: CampaignRecoveryRecord[];
}

interface PreviousSnapshot<Run> extends Omit<CampaignRepositorySnapshot<Run>, "recoveries"> {
  archives: { reference: CampaignRunReference; completedAt: number; run: Run }[];
  recoveries: PreviousRecoveryRecord[];
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

function retiredChapterOneState(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" &&
    (value.tutorial === true || value.layoutVersion === undefined || value.layoutVersion === 1);
}

function retiredChapterOnePayload(value: unknown): boolean {
  return isRecord(value) && value.kind === "legacy" && isRecord(value.save) && retiredChapterOneState(value.save.state);
}

function legacyWorldRun(payload: unknown): { reference: CampaignRunReference; cleared: boolean } | null {
  if (!isRecord(payload) || payload.kind !== "world") return null;
  const run = payload.run;
  if (!isRecord(run) || run.version !== 2 || typeof run.id !== "string" || !run.id.trim()
    || !isStageId(run.stageId) || run.stageId === 1
    || (run.contentRevision !== undefined && run.contentRevision !== "quiet-v1")
    || !["bookmark", "running", "waiting", "blocked", "failed", "cleared"].includes(String(run.phase))) return null;
  return { reference: { runId: run.id, stageId: run.stageId }, cleared: run.phase === "cleared" };
}

function retiredWorldRun(payload: unknown): { reference: CampaignRunReference; cleared: boolean } | null {
  const legacy = legacyWorldRun(payload);
  if (legacy) return legacy;
  if (!isRecord(payload) || payload.kind !== "world") return null;
  const run = parseStageRun(payload.run);
  if (!run || run.contentRevision !== "shared-v1") return null;
  return { reference: { runId: run.id, stageId: run.stageId }, cleared: run.phase === "cleared" };
}

function validRecovery(value: unknown): value is PreviousRecoveryRecord {
  if (!isRecord(value) || (value.kind !== "active" && value.kind !== "archive") ||
    !validReference(value.reference) || value.reference.stageId === 1 ||
    typeof value.recoveredAt !== "number" || !Number.isFinite(value.recoveredAt) || value.recoveredAt < 0) return false;
  const described = retiredWorldRun(value.payload);
  if (!described || !sameReference(described.reference, value.reference)) return false;
  if (value.kind === "active") return value.completedAt === undefined && !described.cleared;
  return typeof value.completedAt === "number" && Number.isFinite(value.completedAt) && value.completedAt >= 0 && described.cleared;
}

function validActiveRecovery(value: unknown): value is CampaignRecoveryRecord {
  return validRecovery(value) && value.kind === "active";
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
  private readonly usesDefaultLegacyArchiveReader: boolean;

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
    this.usesDefaultLegacyArchiveReader = options.legacyArchiveReader === undefined;
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

  private decodePreviousDocument(
    value: unknown,
  ): CampaignRepositoryResult<PreviousSnapshot<Run>> {
    if (
      !isRecord(value) ||
      value.version !== PREVIOUS_DOCUMENT_VERSION ||
      !Array.isArray(value.activeRuns) ||
      !Array.isArray(value.archives) ||
      !Array.isArray(value.recoveries)
    ) {
      return failure("corrupt", "캠페인 저장 데이터의 구조가 올바르지 않습니다.");
    }
    const stateResult = validateCampaignState(value.state);
    if (!stateResult.ok) {
      return failure("corrupt", stateResult.error.message);
    }

    const activeRuns: PreviousSnapshot<Run>["activeRuns"] = [];
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

    const archives: PreviousSnapshot<Run>["archives"] = [];
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

    const recoveries: PreviousRecoveryRecord[] = [];
    const recoveryRunIds = new Set<string>();
    for (const raw of value.recoveries) {
      if (!validRecovery(raw) || storedRunIds.has(raw.reference.runId) || recoveryRunIds.has(raw.reference.runId)) {
        return failure("corrupt", "개편 전 실행 보관 기록을 검증하지 못했습니다.");
      }
      recoveryRunIds.add(raw.reference.runId);
      recoveries.push(structuredClone(raw));
    }

    const expectedActive = stateResult.value.stages
      .map((stage) => stage.activeRun)
      .filter((reference): reference is CampaignRunReference => reference !== null);
    const campaignCompletions = stateResult.value.stages
      .map((stage) =>
        stage.completion?.source === "campaign" ? stage.completion : null,
      )
      .filter((completion) => completion !== null);
    const recoveredCompletions = stateResult.value.stages
      .map((stage) => stage.completion?.source === "content-recovery" ? stage.completion : null)
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
      !recoveredCompletions.every((completion) =>
        recoveries.some((recovery) => recovery.kind === "archive" &&
          sameReference(completion.run, recovery.reference) && completion.completedAt === recovery.completedAt),
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
      value: { state: stateResult.value, activeRuns, archives, recoveries },
    };
  }

  private decodeDocument(value: unknown): CampaignRepositoryResult<CampaignRepositorySnapshot<Run>> {
    if (!isRecord(value) || value.version !== CAMPAIGN_DOCUMENT_VERSION ||
      !Array.isArray(value.activeRuns) || !Array.isArray(value.recoveries) ||
      Object.hasOwn(value, "archives")) {
      return failure("corrupt", "캠페인 저장 데이터의 구조가 올바르지 않습니다.");
    }
    const validated = validateCampaignState(value.state);
    if (!validated.ok) return failure("corrupt", validated.error.message);
    const activeRuns: CampaignRepositorySnapshot<Run>["activeRuns"] = [];
    const seen = new Set<string>();
    for (const raw of value.activeRuns) {
      if (!isRecord(raw) || !validReference(raw.reference) || !Object.hasOwn(raw, "payload") || seen.has(raw.reference.runId)) {
        return failure("corrupt", "활성 실행 기록의 구조가 올바르지 않습니다.");
      }
      const parsed = this.parseStoredRun(raw.payload);
      if (!parsed.ok) return parsed;
      if (!sameReference(parsed.value.reference, raw.reference)) return failure("corrupt", "활성 실행 기록을 검증하지 못했습니다.");
      seen.add(raw.reference.runId);
      activeRuns.push({ reference: raw.reference, run: parsed.value.run });
    }
    const recoveries: CampaignRecoveryRecord[] = [];
    const completedIds = new Set(validated.value.stages.flatMap((stage) => stage.completion ? [stage.completion.run.runId] : []));
    for (const raw of value.recoveries) {
      if (!validActiveRecovery(raw) || seen.has(raw.reference.runId) || completedIds.has(raw.reference.runId)) return failure("corrupt", "개편 전 활성 실행 기록을 검증하지 못했습니다.");
      seen.add(raw.reference.runId);
      recoveries.push(structuredClone(raw));
    }
    const expected = validated.value.stages.flatMap((stage) => stage.activeRun ? [stage.activeRun] : []);
    if (expected.length !== activeRuns.length || expected.some((reference) => !activeRuns.some((entry) => sameReference(entry.reference, reference)))) {
      return failure("corrupt", "캠페인 진행 상태와 활성 실행 기록이 서로 맞지 않습니다.");
    }
    return { ok: true, value: { state: validated.value, activeRuns, recoveries } };
  }

  private documentFromSnapshot(
    snapshot: CampaignRepositorySnapshot<Run>,
  ): CampaignDocument {
    return {
      version: CAMPAIGN_DOCUMENT_VERSION,
      state: snapshot.state,
      activeRuns: snapshot.activeRuns.map(({ reference, run }) => ({
        reference,
        payload: this.authority.serialize(run),
      })),
      recoveries: snapshot.recoveries.map((recovery) => structuredClone(recovery)),
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
  ): Promise<CampaignRepositoryResult<PreviousSnapshot<Run>>> {
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

    const applicableCurrent = currentSave && retiredChapterOneState(currentSave.state) &&
      (currentSave.state.tutorial || currentSave.state.phase !== "cleared") ? null : currentSave;
    if (currentSave === null && legacyArchives.length === 0) {
      try {
        return {
          ok: true,
          value: {
            state: createCampaignState(writer),
            activeRuns: [],
            archives: [],
            recoveries: [],
          },
        };
      } catch (cause) {
        return failure("invalid-state", "새 캠페인 상태를 만들지 못했습니다.", cause);
      }
    }

    const archives: (PreviousSnapshot<Run>["archives"][number] & {
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

    let activeRun: PreviousSnapshot<Run>["activeRuns"][number] | null =
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

    if (currentCompletion !== null && !archives.some((item) => sameReference(item.reference, currentCompletion))) {
      return failure("conflict", "현재 완료 실행을 보관 기록에서 확인하지 못했습니다.");
    }
    const canonical = archives.length > 0
      ? archives.reduce((latest, item) => item.completedAt > latest.completedAt ? item : latest)
      : null;
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
              bestScore: canonical ? currentSave?.best ?? null : null,
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
        recoveries: [],
      },
    };
  }

  private scoreOf(run: Run): number | null {
    try {
      const score = this.authority.score?.(run) ?? null;
      return typeof score === "number" && Number.isInteger(score) && score >= 0 ? score : null;
    } catch {
      return null;
    }
  }

  private scoreInLegacyPayload(payload: unknown): number | null {
    if (!isRecord(payload) || payload.kind !== "legacy" || !isRecord(payload.save)) return null;
    const best = payload.save.best;
    return typeof best === "number" && Number.isInteger(best) && best >= 0 ? best : null;
  }

  private scoreInRetiredRecovery(recovery: PreviousRecoveryRecord): number | null {
    if (recovery.kind !== "archive" || !isRecord(recovery.payload) || !isRecord(recovery.payload.run)) return null;
    const notebook = recovery.payload.run.notebook;
    if (!isRecord(notebook)) return null;
    const { deaths, penaltyDeaths } = notebook;
    return typeof deaths === "number" && Number.isInteger(deaths) && deaths >= 0 &&
      typeof penaltyDeaths === "number" && Number.isInteger(penaltyDeaths) && penaltyDeaths >= 0
      ? deaths + penaltyDeaths : null;
  }

  private compactPreviousSnapshot(
    previous: PreviousSnapshot<Run>,
    standaloneArchives: readonly SaveData[] = [],
  ): CampaignRepositoryResult<CampaignDocument> {
    const scores = previous.state.stages.map((stage) => stage.bestScore);
    const completions = previous.state.stages.map((stage) => stage.completion);
    const advanceCompletion = (
      reference: CampaignRunReference,
      completedAt: number,
      source: "campaign" | "legacy" | "content-recovery",
    ) => {
      const index = reference.stageId - 1;
      if (completions[index] === null || completedAt > completions[index].completedAt) {
        completions[index] = { run: reference, completedAt, source };
      }
    };
    const addScore = (stageId: number, score: number | null) => {
      if (score === null) return;
      const index = stageId - 1;
      scores[index] = scores[index] === null ? score : Math.min(scores[index]!, score);
    };
    for (const archive of previous.archives) {
      addScore(archive.reference.stageId, this.scoreOf(archive.run));
      addScore(archive.reference.stageId, this.scoreInLegacyPayload(this.authority.serialize(archive.run)));
      advanceCompletion(archive.reference, archive.completedAt, "campaign");
    }
    for (const recovery of previous.recoveries) {
      addScore(recovery.reference.stageId, this.scoreInRetiredRecovery(recovery));
      if (recovery.kind === "archive" && recovery.completedAt !== undefined) {
        advanceCompletion(recovery.reference, recovery.completedAt, "content-recovery");
      }
    }
    for (const active of previous.activeRuns) {
      if (previous.state.stages[active.reference.stageId - 1].completion !== null) {
        addScore(active.reference.stageId, this.scoreInLegacyPayload(this.authority.serialize(active.run)));
      }
    }
    const standalone: { reference: CampaignRunReference; completedAt: number; score: number | null; payload: unknown }[] = [];
    for (const save of standaloneArchives) {
      const mapped = this.mapLegacySave(save, true);
      if (!mapped.ok) return mapped;
      const prior = standalone.find((item) => item.reference.runId === mapped.value.reference.runId);
      const existing = previous.archives.find((item) => item.reference.runId === mapped.value.reference.runId);
      if (prior && (prior.completedAt !== save.savedAt || !sameStoredValue(prior.payload, mapped.value.payload))) {
        return failure("conflict", "같은 ID의 완료 기록 내용이 서로 달라 마이그레이션하지 않았습니다.");
      }
      if (existing && (existing.completedAt !== save.savedAt || !sameStoredValue(this.authority.serialize(existing.run), mapped.value.payload))) {
        return failure("conflict", "보관함과 캠페인의 완료 기록 내용이 서로 다릅니다.");
      }
      if (previous.activeRuns.some((item) => item.reference.runId === mapped.value.reference.runId)) {
        return failure("conflict", "진행 중인 실행 ID가 완료 보관 기록과 겹칩니다.");
      }
      if (!prior) standalone.push({ reference: mapped.value.reference, completedAt: save.savedAt,
        score: this.scoreOf(mapped.value.run), payload: mapped.value.payload });
      addScore(1, this.scoreOf(mapped.value.run));
      addScore(1, save.best);
    }
    const latestStandalone = standalone.length > 0
      ? standalone.reduce((latest, item) => item.completedAt > latest.completedAt ? item : latest)
      : null;
    const newlyCompleted = latestStandalone &&
      (completions[0] === null || latestStandalone.completedAt > completions[0].completedAt)
      ? latestStandalone : null;
    if (newlyCompleted) advanceCompletion(newlyCompleted.reference, newlyCompleted.completedAt, "legacy");
    const state = validateCampaignState({
      ...previous.state,
      stages: previous.state.stages.map((stage, index) => index === 0 && newlyCompleted
        ? { ...stage, status: "completed", bestScore: scores[index],
            completion: completions[index] }
        : index === 1 && newlyCompleted && stage.status === "locked"
          ? { ...stage, status: "unlocked", bestScore: scores[index] }
          : { ...stage, bestScore: scores[index], completion: completions[index] }),
    });
    if (!state.ok) return failure("corrupt", state.error.message);
    const document = this.documentFromSnapshot({
      state: state.value,
      activeRuns: previous.activeRuns,
      recoveries: previous.recoveries.filter((recovery): recovery is CampaignRecoveryRecord => recovery.kind === "active"),
    });
    const decoded = this.decodeDocument(document);
    return decoded.ok ? { ok: true, value: document } : decoded;
  }

  /**
   * Detaches retired stage 2+ runs before current content validation.
   * The transform is fail-closed and is committed with the replacement root.
   */
  private migrateContentDocument(
    value: unknown,
    writer: string,
  ): CampaignRepositoryResult<PreviousCampaignDocument> {
    if (isRecord(value) && value.version === PREVIOUS_DOCUMENT_VERSION) {
      const decoded = this.decodePreviousDocument(value);
      return decoded.ok ? { ok: true, value: value as unknown as PreviousCampaignDocument } : decoded;
    }
    if (!isRecord(value) ||
      (Object.hasOwn(value, "version") && value.version !== 2 && value.version !== 3) ||
      !Array.isArray(value.activeRuns) || !Array.isArray(value.archives) ||
      (value.recoveries !== undefined && !Array.isArray(value.recoveries))) {
      return failure("corrupt", "캠페인 저장 데이터의 구조가 올바르지 않습니다.");
    }
    const stateResult = validateCampaignState(value.state);
    if (!stateResult.ok) return failure("corrupt", stateResult.error.message);

    const retainedActive: StoredRun[] = [];
    const retainedArchives: StoredArchive[] = [];
    const recoveries: PreviousRecoveryRecord[] = [];
    const seen = new Set<string>();
    const recoveredAt = Date.now();
    const activeReferences: CampaignRunReference[] = [];

    for (const raw of value.activeRuns) {
      if (!isRecord(raw) || !validReference(raw.reference) || !Object.hasOwn(raw, "payload") || seen.has(raw.reference.runId)) {
        return failure("corrupt", "활성 실행 기록의 구조가 올바르지 않습니다.");
      }
      seen.add(raw.reference.runId);
      activeReferences.push(raw.reference);
      if (raw.reference.stageId === 1) {
        retainedActive.push({ reference: raw.reference, payload: structuredClone(raw.payload) });
        continue;
      }
      const legacy = retiredWorldRun(raw.payload);
      if (legacy) {
        if (legacy.cleared || !sameReference(legacy.reference, raw.reference)) {
          return failure("corrupt", "개편 전 활성 실행 기록을 검증하지 못했습니다.");
        }
        recoveries.push({ kind: "active", reference: raw.reference, payload: structuredClone(raw.payload), recoveredAt });
        continue;
      }
      const current = this.parseStoredRun(raw.payload);
      if (!current.ok || !sameReference(current.value.reference, raw.reference)) {
        return failure("corrupt", "활성 실행 기록을 검증하지 못했습니다.");
      }
      retainedActive.push({ reference: raw.reference, payload: structuredClone(raw.payload) });
    }

    for (const raw of value.archives) {
      if (!isRecord(raw) || !validReference(raw.reference) || !Object.hasOwn(raw, "payload") ||
        typeof raw.completedAt !== "number" || !Number.isFinite(raw.completedAt) || raw.completedAt < 0 || seen.has(raw.reference.runId)) {
        return failure("corrupt", "완료 실행 기록의 구조가 올바르지 않습니다.");
      }
      seen.add(raw.reference.runId);
      if (stateResult.value.stages[raw.reference.stageId - 1].status !== "completed") {
        return failure("corrupt", "완료 실행 기록이 완료되지 않은 장에 연결되어 있습니다.");
      }
      if (raw.reference.stageId === 1) {
        retainedArchives.push({ reference: raw.reference, payload: structuredClone(raw.payload), completedAt: raw.completedAt });
        continue;
      }
      const legacy = retiredWorldRun(raw.payload);
      if (legacy) {
        if (!legacy.cleared || !sameReference(legacy.reference, raw.reference)) {
          return failure("corrupt", "개편 전 완료 실행 기록을 검증하지 못했습니다.");
        }
        recoveries.push({ kind: "archive", reference: raw.reference, payload: structuredClone(raw.payload), recoveredAt, completedAt: raw.completedAt });
        continue;
      }
      const current = this.parseStoredRun(raw.payload);
      let cleared = false;
      if (current.ok && sameReference(current.value.reference, raw.reference)) {
        try { cleared = this.authority.isCleared(current.value.run); } catch { cleared = false; }
      }
      if (!current.ok || !cleared) return failure("corrupt", "완료 실행 기록을 검증하지 못했습니다.");
      retainedArchives.push({ reference: raw.reference, payload: structuredClone(raw.payload), completedAt: raw.completedAt });
    }

    for (const raw of Array.isArray(value.recoveries) ? value.recoveries : []) {
      if (!validRecovery(raw) || seen.has(raw.reference.runId)) {
        return failure("corrupt", "기존 실행 보관 기록을 검증하지 못했습니다.");
      }
      seen.add(raw.reference.runId);
      recoveries.push(structuredClone(raw));
    }

    const expectedActive = stateResult.value.stages.flatMap((stage) => stage.activeRun ? [stage.activeRun] : []);
    if (expectedActive.length !== activeReferences.length ||
      expectedActive.some((reference) => !activeReferences.some((candidate) => sameReference(reference, candidate)))) {
      return failure("corrupt", "캠페인 진행 상태와 활성 실행 기록이 서로 맞지 않습니다.");
    }
    for (const stage of stateResult.value.stages) {
      const completion = stage.completion;
      if (completion?.source !== "campaign") continue;
      const archive = [...retainedArchives, ...recoveries.filter((item): item is PreviousRecoveryRecord & { completedAt: number } => item.kind === "archive")]
        .find((item) => sameReference(item.reference, completion.run) && item.completedAt === completion.completedAt);
      if (!archive) return failure("corrupt", "완료 증거를 보관 기록에서 확인하지 못했습니다.");
    }

    const recoveredActiveIds = new Set(recoveries.filter((item) => item.kind === "active").map((item) => item.reference.runId));
    const recoveredArchiveIds = new Set(recoveries.filter((item) => item.kind === "archive").map((item) => item.reference.runId));
    const migratedState = validateCampaignState({
      ...stateResult.value,
      writer,
      revision: stateResult.value.revision + 1,
      stages: stateResult.value.stages.map((stage) => ({
        ...stage,
        activeRun: stage.activeRun && recoveredActiveIds.has(stage.activeRun.runId) ? null : stage.activeRun,
        completion: stage.completion && recoveredArchiveIds.has(stage.completion.run.runId)
          ? { ...stage.completion, source: "content-recovery" }
          : stage.completion,
      })),
    });
    if (!migratedState.ok) return failure("corrupt", migratedState.error.message);
    return {
      ok: true,
      value: {
        version: PREVIOUS_DOCUMENT_VERSION,
        state: migratedState.value,
        activeRuns: retainedActive,
        archives: retainedArchives,
        recoveries,
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

  private migrateToCurrentDocument(
    value: unknown,
    writer: string,
    standaloneArchives: readonly SaveData[] = [],
  ): CampaignRepositoryResult<CampaignDocument> {
    const previous = this.migrateContentDocument(value, writer);
    if (!previous.ok) return previous;
    const decoded = this.decodePreviousDocument(previous.value);
    if (!decoded.ok) return decoded;
    return this.compactPreviousSnapshot(decoded.value, standaloneArchives);
  }

  private async readStandaloneBeforeMigration(): Promise<CampaignRepositoryResult<readonly SaveData[]>> {
    const saves: SaveData[] = [];
    const storage = this.resolveLegacyStorage();
    if (storage) {
      const loaded = loadSave(storage);
      if (!loaded.ok) return failure(loaded.error.code === "read" ? "read" : "corrupt", loaded.error.message, loaded.error.cause);
      if (loaded.value && loaded.value.state.phase === "cleared" && !loaded.value.state.tutorial) saves.push(loaded.value);
    }
    if (this.legacyArchiveReader === null) return { ok: true, value: saves };
    try {
      const archived = await this.legacyArchiveReader();
      return Array.isArray(archived) ? { ok: true, value: [...saves, ...archived] }
        : failure("corrupt", "기존 모험 보관함 응답이 올바르지 않습니다.");
    } catch (cause) {
      return failure("read", "기존 모험 보관함을 모두 읽지 못해 마이그레이션하지 않았습니다.", cause);
    }
  }

  private resolveLegacyStorage(): (StorageLike & { removeItem?: (key: string) => void }) | null {
    if (this.legacyStorage === null) return null;
    if (this.legacyStorage !== undefined) return this.legacyStorage;
    try { return typeof localStorage === "undefined" ? null : localStorage; }
    catch { return null; }
  }

  private async reconcileStandaloneArchives(
    snapshot: CampaignRepositorySnapshot<Run>,
    writer: string,
  ): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    let records: Awaited<ReturnType<typeof listStageArchives>> = [];
    if (this.usesDefaultLegacyArchiveReader) {
      try { records = await listStageArchives(); }
      catch { return { ok: true, value: snapshot }; }
    }
    const storage = this.resolveLegacyStorage();
    let localCompleted: { save: SaveData; bytes: string } | null = null;
    if (storage && this.migrateLegacyRun) {
      try {
        const bytes = storage.getItem(STORAGE_KEY);
        if (bytes !== null) {
          const loaded = loadSave({ getItem: () => bytes, setItem: () => undefined });
          if (loaded.ok && loaded.value && loaded.value.state.phase === "cleared" && !loaded.value.state.tutorial) {
            localCompleted = { save: loaded.value, bytes };
          }
        }
      } catch { /* Keep a local save that cannot be read safely. */ }
    }
    if (records.length === 0 && localCompleted === null) return { ok: true, value: snapshot };
    const saves = [...records.map((record) => record.save), ...(localCompleted ? [localCompleted.save] : [])];
    const committed = await this.store.mutate((current) => {
      if (current === null) return failure("conflict", "캠페인 저장 데이터가 다른 창에서 바뀌었습니다.");
      const decoded = this.decodeDocument(current);
      if (!decoded.ok) return decoded;
      const previous: PreviousSnapshot<Run> = { ...decoded.value, archives: [] };
      const compacted = this.compactPreviousSnapshot(previous, saves);
      if (!compacted.ok) return compacted;
      const nextState = (compacted.value.state.stages.some((stage, index) =>
        !sameStoredValue(stage, decoded.value.state.stages[index])))
        ? { ...compacted.value.state, writer, revision: decoded.value.state.revision + 1 }
        : compacted.value.state;
      const document = { ...compacted.value, state: nextState };
      const result = this.decodeDocument(document);
      return result.ok ? { ok: true, value: { document, result: result.value } } : result;
    });
    if (!committed.ok) return committed;
    try { await clearStageArchives(records); } catch { /* Retry after a later load. */ }
    if (storage && localCompleted && typeof storage.removeItem === "function") {
      try {
        if (storage.getItem(STORAGE_KEY) === localCompleted.bytes) storage.removeItem(STORAGE_KEY);
      } catch { /* Retry after a later load. */ }
    }
    return committed;
  }

  /** Drop retired first-chapter active content before the current runtime can parse it. */
  async loadOrCreate(writer: string): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    const read = await this.store.read();
    if (!read.ok) return read;
    const hasRetired = (value: unknown): boolean => isRecord(value) && Array.isArray(value.activeRuns) &&
      value.activeRuns.some((entry) => isRecord(entry) && retiredChapterOnePayload(entry.payload));
    if (hasRetired(read.value)) {
      const removed = await this.store.mutate((current) => {
        if (!isRecord(current) || !Array.isArray(current.activeRuns)) return failure("conflict", "캠페인 기록이 다른 창에서 바뀌었습니다.");
        const state = validateCampaignState(current.state);
        if (!state.ok) return failure("corrupt", state.error.message);
        const discarded = current.activeRuns.filter((entry) => isRecord(entry) && retiredChapterOnePayload(entry.payload));
        for (const entry of discarded) {
          if (!isRecord(entry) || !validReference(entry.reference) || entry.reference.stageId !== 1 ||
            !isRecord(entry.payload) || !isRecord(entry.payload.save) || !isRecord(entry.payload.save.state) ||
            entry.reference.runId !== entry.payload.save.state.id ||
            !state.value.stages[0].activeRun || !sameReference(state.value.stages[0].activeRun, entry.reference)) {
            return failure("corrupt", "이전 1장 기록의 연결을 확인하지 못했습니다.");
          }
        }
        const cleaned = { ...current, activeRuns: current.activeRuns.filter((entry) => !discarded.includes(entry)),
          state: { ...state.value, writer, revision: state.value.revision + (discarded.length ? 1 : 0),
            stages: state.value.stages.map((stage) => stage.stageId === 1 && discarded.length ? { ...stage, activeRun: null } : stage) } };
        const document = current.version === CAMPAIGN_DOCUMENT_VERSION ? { ok: true as const, value: cleaned as unknown as CampaignDocument }
          : this.migrateToCurrentDocument(cleaned, writer);
        if (!document.ok) return document;
        const decoded = this.decodeDocument(document.value);
        return decoded.ok ? { ok: true, value: { document: document.value, result: decoded.value } } : decoded;
      });
      if (!removed.ok) return removed;
    }
    const loaded = await this.loadOrCreateCurrent(writer);
    if (!loaded.ok) return loaded;
    const storage = this.resolveLegacyStorage();
    if (storage && typeof storage.removeItem === "function") {
      try {
        const bytes = storage.getItem(STORAGE_KEY);
        if (bytes !== null) {
          const value: unknown = JSON.parse(bytes);
          if (isRecord(value) && retiredChapterOneState(value.state) && storage.getItem(STORAGE_KEY) === bytes) storage.removeItem(STORAGE_KEY);
        }
        storage.removeItem("one-line-per-death:legacy-onboarding:v1");
      } catch { /* Retry cleanup after a later successful load. */ }
    }
    return loaded;
  }

  private async loadOrCreateCurrent(
    writer: string,
  ): Promise<CampaignRepositoryResult<CampaignRepositorySnapshot<Run>>> {
    const read = await this.store.read();
    if (!read.ok) return read;
    if (read.value !== null) {
      if (isRecord(read.value) && read.value.version === CAMPAIGN_DOCUMENT_VERSION) {
        const decoded = this.decodeDocument(read.value);
        if (!decoded.ok) return decoded;
        const reconciled = await this.reconcileStandaloneArchives(decoded.value, writer);
        return reconciled;
      }
      const standalone = await this.readStandaloneBeforeMigration();
      if (!standalone.ok) return standalone;
      const migrated = await this.store.mutate((current) => {
        if (current === null) return failure("conflict", "캠페인 저장 데이터가 다른 창에서 바뀌었습니다.");
        const document = isRecord(current) && current.version === CAMPAIGN_DOCUMENT_VERSION
          ? { ok: true as const, value: current as unknown as CampaignDocument }
          : this.migrateToCurrentDocument(current, writer, standalone.value);
        if (!document.ok) return document;
        const decoded = this.decodeDocument(document.value);
        if (!decoded.ok) return decoded;
        return { ok: true, value: { document: document.value, result: decoded.value } };
      });
      if (!migrated.ok) return migrated;
      const reconciled = await this.reconcileStandaloneArchives(migrated.value, writer);
      return reconciled;
    }

    const prepared = await this.initialSnapshot(writer);
    if (!prepared.ok) return prepared;
    const initial = this.compactPreviousSnapshot(prepared.value);
    if (!initial.ok) return initial;
    const created = await this.store.mutate((current) => {
      if (current !== null) {
        const migrated = isRecord(current) && current.version === CAMPAIGN_DOCUMENT_VERSION
          ? { ok: true as const, value: current as unknown as CampaignDocument }
          : this.migrateToCurrentDocument(current, writer);
        if (!migrated.ok) return migrated;
        const decoded = this.decodeDocument(migrated.value);
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          value: { document: migrated.value, result: decoded.value },
        };
      }
      const decoded = this.decodeDocument(initial.value);
      if (!decoded.ok) return decoded;
      return {
        ok: true,
        value: { document: initial.value, result: decoded.value },
      };
    });
    if (!created.ok) return created;
    const reread = await this.store.read();
    if (!reread.ok) return reread;
    if (reread.value === null) {
      return failure("write", "저장한 캠페인 상태를 다시 확인하지 못했습니다.");
    }
    const decoded = this.decodeDocument(reread.value);
    if (!decoded.ok) return decoded;
    const reconciled = await this.reconcileStandaloneArchives(decoded.value, writer);
    return reconciled;
  }

  async load(): Promise<
    CampaignRepositoryResult<CampaignRepositorySnapshot<Run> | null>
  > {
    const read = await this.store.read();
    if (!read.ok) return read;
    if (read.value === null) return { ok: true, value: null };
    if (!isRecord(read.value) || read.value.version !== CAMPAIGN_DOCUMENT_VERSION) {
      return this.loadOrCreate(isRecord(read.value) && isRecord(read.value.state) &&
        typeof read.value.state.writer === "string" ? read.value.state.writer : "migration");
    }
    if (Array.isArray(read.value.activeRuns) && read.value.activeRuns.some((entry) => isRecord(entry) && retiredChapterOnePayload(entry.payload))) {
      return this.loadOrCreate(isRecord(read.value.state) && typeof read.value.state.writer === "string" ? read.value.state.writer : "migration");
    }
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
      const previousActive = decoded.value.activeRuns.find((item) =>
        sameReference(item.reference, verified.value.reference));
      if (previousActive) {
        const remembered = this.scoreInLegacyPayload(this.authority.serialize(previousActive.run));
        if (remembered !== null) {
          const index = verified.value.reference.stageId - 1;
          const stage = nextState.value.stages[index];
          nextState.value.stages[index] = {
            ...stage,
            bestScore: stage.bestScore === null ? remembered : Math.min(stage.bestScore, remembered),
          };
        }
      }
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
        recoveries: decoded.value.recoveries,
      };
      const document = this.documentFromSnapshot(next);
      return { ok: true, value: { document, result: next } };
    });
    if (!saved.ok) return saved;
    return { ok: true, value: saved.value };
  }
}
