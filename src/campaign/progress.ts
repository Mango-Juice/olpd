import { STAGES, isStageId } from "./catalog";
import type { Settings } from "../game/types";
import type { StageId } from "./types";

export const CAMPAIGN_STATE_VERSION = 1 as const;

export interface CampaignRunReference {
  runId: string;
  stageId: StageId;
}

export interface CampaignCompletion {
  run: CampaignRunReference;
  completedAt: number;
  /** Legacy completions are evidence validated by game/storage before migration. */
  source: "campaign" | "legacy";
}

export type CampaignStageStatus = "locked" | "unlocked" | "completed";

export interface CampaignStageProgress {
  stageId: StageId;
  status: CampaignStageStatus;
  activeRun: CampaignRunReference | null;
  completion: CampaignCompletion | null;
}

/** JSON/structured-clone-safe campaign state. Runtime payloads live in the repository. */
export interface CampaignState {
  version: typeof CAMPAIGN_STATE_VERSION;
  writer: string;
  revision: number;
  /** null follows the operating-system preference until the user chooses. */
  settings: Settings | null;
  stages: CampaignStageProgress[];
}

export interface CampaignStamp {
  writer: string;
  revision: number;
}

export type CampaignProgressErrorCode =
  | "invalid-state"
  | "invalid-run"
  | "locked"
  | "active-run-mismatch";

export interface CampaignProgressError {
  code: CampaignProgressErrorCode;
  message: string;
}

export type CampaignProgressResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CampaignProgressError };

export interface RunCompletionAuthority<Run> {
  /** Must reject malformed or semantically impossible serialized runs. */
  parse(value: unknown): Run | null;
  serialize(run: Run): unknown;
  describe(run: Run): CampaignRunReference | null;
  isCleared(run: Run): boolean;
}

const verifiedCompletion = Symbol("verified campaign run completion");

export interface VerifiedRunCompletion<Run> {
  readonly run: Run;
  readonly reference: CampaignRunReference;
  readonly serialized: unknown;
  readonly [verifiedCompletion]: true;
}

function failure(
  code: CampaignProgressErrorCode,
  message: string,
): CampaignProgressResult<never> {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validSettings(value: unknown): value is Settings | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.muted === "boolean" &&
      typeof value.reducedMotion === "boolean")
  );
}

function validRunReference(value: unknown): value is CampaignRunReference {
  return (
    isRecord(value) &&
    isNonEmptyString(value.runId) &&
    isStageId(value.stageId)
  );
}

function validCompletion(
  value: unknown,
  stageId: StageId,
): value is CampaignCompletion {
  return (
    isRecord(value) &&
    validRunReference(value.run) &&
    value.run.stageId === stageId &&
    typeof value.completedAt === "number" &&
    Number.isFinite(value.completedAt) &&
    value.completedAt >= 0 &&
    (value.source === "campaign" ||
      (value.source === "legacy" && stageId === 1))
  );
}

export function validateCampaignState(
  value: unknown,
): CampaignProgressResult<CampaignState> {
  const settings =
    isRecord(value) && !Object.hasOwn(value, "settings")
      ? null
      : isRecord(value)
        ? value.settings
        : undefined;
  if (
    !isRecord(value) ||
    value.version !== CAMPAIGN_STATE_VERSION ||
    !isNonEmptyString(value.writer) ||
    !isNonNegativeInteger(value.revision) ||
    !Array.isArray(value.stages) ||
    value.stages.length !== STAGES.length ||
    !validSettings(settings)
  ) {
    return failure("invalid-state", "캠페인 저장 상태의 구조가 올바르지 않습니다.");
  }

  const stages: CampaignStageProgress[] = [];
  const runIds = new Set<string>();
  for (let index = 0; index < STAGES.length; index += 1) {
    const expectedId = STAGES[index].id;
    const raw = value.stages[index];
    if (
      !isRecord(raw) ||
      raw.stageId !== expectedId ||
      (raw.status !== "locked" &&
        raw.status !== "unlocked" &&
        raw.status !== "completed") ||
      !(raw.activeRun === null || validRunReference(raw.activeRun)) ||
      !(raw.completion === null || validCompletion(raw.completion, expectedId))
    ) {
      return failure("invalid-state", "단계 진행 상태가 올바르지 않습니다.");
    }

    const activeRun = raw.activeRun;
    const completion = raw.completion;
    if (activeRun !== null && activeRun.stageId !== expectedId) {
      return failure("invalid-state", "활성 실행이 다른 단계에 연결되어 있습니다.");
    }
    if (
      (raw.status === "completed") !== (completion !== null) ||
      (raw.status === "locked" && activeRun !== null)
    ) {
      return failure("invalid-state", "단계 상태와 실행 참조가 서로 맞지 않습니다.");
    }

    const previous = stages[index - 1];
    const shouldBeAvailable = index === 0 || previous.status === "completed";
    if ((raw.status !== "locked") !== shouldBeAvailable) {
      return failure("invalid-state", "단계가 순서대로 잠금 해제되지 않았습니다.");
    }

    for (const reference of [activeRun, completion?.run ?? null]) {
      if (reference !== null) {
        if (runIds.has(reference.runId)) {
          return failure("invalid-state", "같은 실행이 여러 단계에 연결되어 있습니다.");
        }
        runIds.add(reference.runId);
      }
    }
    stages.push({
      stageId: expectedId,
      status: raw.status,
      activeRun,
      completion,
    });
  }

  return {
    ok: true,
    value: {
      version: CAMPAIGN_STATE_VERSION,
      writer: value.writer,
      revision: value.revision,
      settings:
        settings === null
          ? null
          : {
              muted: settings.muted,
              reducedMotion: settings.reducedMotion,
            },
      stages,
    },
  };
}

export function createCampaignState(writer: string): CampaignState {
  if (!isNonEmptyString(writer)) {
    throw new Error("캠페인 작성자 ID가 필요합니다.");
  }
  return {
    version: CAMPAIGN_STATE_VERSION,
    writer,
    revision: 0,
    settings: null,
    stages: STAGES.map(({ id }, index) => ({
      stageId: id,
      status: index === 0 ? "unlocked" : "locked",
      activeRun: null,
      completion: null,
    })),
  };
}

export function updateCampaignSettings(
  state: CampaignState,
  settings: Settings,
  writer: string,
): CampaignProgressResult<CampaignState> {
  const valid = validateCampaignState(state);
  if (!valid.ok) return valid;
  if (!isNonEmptyString(writer) || !validSettings(settings) || settings === null) {
    return failure("invalid-state", "캠페인 설정 값이 올바르지 않습니다.");
  }
  return {
    ok: true,
    value: {
      ...valid.value,
      writer,
      revision: valid.value.revision + 1,
      settings: {
        muted: settings.muted,
        reducedMotion: settings.reducedMotion,
      },
    },
  };
}

/**
 * Produces completion evidence from an actual run. The round trip prevents a
 * serializer from persisting bytes its own semantic parser would reject.
 */
export function verifyRunCompletion<Run>(
  run: Run,
  authority: RunCompletionAuthority<Run>,
): CampaignProgressResult<VerifiedRunCompletion<Run>> {
  let serialized: unknown;
  let parsed: Run | null;
  let reference: CampaignRunReference | null;
  let cleared: boolean;
  try {
    serialized = authority.serialize(run);
    parsed = authority.parse(serialized);
    reference = parsed === null ? null : authority.describe(parsed);
    cleared = parsed !== null && authority.isCleared(parsed);
  } catch {
    return failure("invalid-run", "실행 기록을 검증하지 못했습니다.");
  }
  if (
    parsed === null ||
    reference === null ||
    !validRunReference(reference) ||
    !cleared
  ) {
    return failure("invalid-run", "완료가 검증된 실행 기록이 아닙니다.");
  }
  return {
    ok: true,
    value: {
      run: parsed,
      reference,
      serialized,
      [verifiedCompletion]: true,
    },
  };
}

export function setActiveRun(
  state: CampaignState,
  run: CampaignRunReference,
  writer: string,
): CampaignProgressResult<CampaignState> {
  const valid = validateCampaignState(state);
  if (!valid.ok) return valid;
  if (!isNonEmptyString(writer) || !validRunReference(run)) {
    return failure("invalid-run", "활성 실행 참조가 올바르지 않습니다.");
  }
  const stage = valid.value.stages[run.stageId - 1];
  if (stage.status === "locked") {
    return failure("locked", "잠긴 단계에는 실행을 저장할 수 없습니다.");
  }
  const duplicate = valid.value.stages.some(
    (item) =>
      item.completion?.run.runId === run.runId ||
      (item.stageId !== run.stageId && item.activeRun?.runId === run.runId),
  );
  if (duplicate) {
    return failure("invalid-run", "이미 사용 중인 실행 ID는 다시 사용할 수 없습니다.");
  }

  return {
    ok: true,
    value: {
      ...valid.value,
      writer,
      revision: valid.value.revision + 1,
      stages: valid.value.stages.map((item) =>
        item.stageId === run.stageId ? { ...item, activeRun: run } : item,
      ),
    },
  };
}

export function completeVerifiedRun<Run>(
  state: CampaignState,
  completion: VerifiedRunCompletion<Run>,
  writer: string,
  completedAt: number,
): CampaignProgressResult<CampaignState> {
  const valid = validateCampaignState(state);
  if (!valid.ok) return valid;
  if (
    !isNonEmptyString(writer) ||
    !completion ||
    completion[verifiedCompletion] !== true ||
    !Number.isFinite(completedAt) ||
    completedAt < 0
  ) {
    return failure("invalid-run", "완료 증거가 올바르지 않습니다.");
  }

  const { reference } = completion;
  const stage = valid.value.stages[reference.stageId - 1];
  if (stage.status === "locked") {
    return failure("locked", "잠긴 단계는 완료할 수 없습니다.");
  }
  if (stage.activeRun?.runId !== reference.runId) {
    return failure(
      "active-run-mismatch",
      "현재 활성 실행과 완료하려는 실행이 다릅니다.",
    );
  }

  const followingId = reference.stageId + 1;
  const nextStageId = isStageId(followingId) ? followingId : null;
  return {
    ok: true,
    value: {
      ...valid.value,
      writer,
      revision: valid.value.revision + 1,
      stages: valid.value.stages.map((item) => {
        if (item.stageId === reference.stageId && item.status === "completed") {
          return { ...item, activeRun: null };
        }
        if (item.stageId === reference.stageId) {
          return {
            ...item,
            status: "completed",
            activeRun: null,
            completion: {
              run: reference,
              completedAt,
              source: "campaign",
            },
          };
        }
        if (item.stageId === nextStageId && item.status === "locked") {
          return { ...item, status: "unlocked" };
        }
        return item;
      }),
    },
  };
}
