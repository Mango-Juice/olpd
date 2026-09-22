import { CONFIG } from "./content";
import type { StorageResult } from "./storage";
import type { Action, Interpretation, ObservationId } from "./types";

export const ONBOARDING_VERSION = 1 as const;
export const ONBOARDING_STORAGE_KEY =
  "one-line-per-death:legacy-onboarding:v1";

export type OnboardingStageId =
  | "first-step"
  | "single-gap"
  | "low-arch"
  | "side-path";

export type NarrativeChoice = "unseen" | "read" | "skipped";

export interface OnboardingStage {
  id: OnboardingStageId;
  title: string;
  goal: string;
  expectedAction: Action;
  observationIds: readonly ObservationId[];
  hint: readonly [string, string, string];
}

export interface OnboardingAttempt {
  sequence: number;
  stageId: OnboardingStageId;
  text: string;
  action: Action;
  applied: boolean;
  succeeded: boolean;
}

export interface OnboardingProgress {
  version: typeof ONBOARDING_VERSION;
  ownerRunId: string;
  narrative: NarrativeChoice;
  currentStage: number;
  completedStageIds: OnboardingStageId[];
  attempts: OnboardingAttempt[];
  handedOffRunId: string | null;
}

export interface OnboardingAttemptResult {
  progress: OnboardingProgress;
  attempt: OnboardingAttempt;
  message: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const ONBOARDING_STAGES: readonly OnboardingStage[] = [
  {
    id: "first-step",
    title: "한 걸음의 약속",
    goal: "열린 문까지 걸어간다.",
    expectedAction: "advance",
    observationIds: ["clear"],
    hint: [
      "평평한 돌길 끝에 열린 문 하나만 있어요.",
      "지금은 위험을 피하기보다 문 쪽으로 몸을 움직이면 돼요.",
      "문 쪽으로 걸어가라는 뜻을 한 줄로 전해 보세요.",
    ],
  },
  {
    id: "single-gap",
    title: "끊긴 바닥 하나",
    goal: "바닥 틈을 넘어 문에 닿는다.",
    expectedAction: "jump",
    observationIds: ["bridge", "pit"],
    hint: [
      "용사와 문 사이의 좁은 바닥 틈을 살펴보세요.",
      "그냥 걸으면 쿠션에 내려앉아요. 틈 위를 넘는 몸동작이 필요해요.",
      "바닥이 끊긴 곳을 뛰어넘으라는 뜻을 한 줄로 전해 보세요.",
    ],
  },
  {
    id: "low-arch",
    title: "머리 위 돌",
    goal: "낮은 돌 아치 아래를 지나간다.",
    expectedAction: "duck",
    observationIds: ["lowCeiling"],
    hint: [
      "이어진 바닥보다 용사의 머리 높이와 돌 아치를 살펴보세요.",
      "선 채로는 막히지만 몸의 높이를 줄이면 지나갈 수 있어요.",
      "머리 위가 낮을 때 숙여 가라는 뜻을 한 줄로 전해 보세요.",
    ],
  },
  {
    id: "side-path",
    title: "옆으로 난 길",
    goal: "연결된 샛길을 따라 문까지 간다.",
    expectedAction: "detour",
    observationIds: ["pitCeilingPath", "spikesCeilingPath"],
    hint: [
      "두꺼운 정면 벽과 옆으로 이어진 민트빛 길을 함께 살펴보세요.",
      "벽을 넘는 대신 실제로 연결된 다른 경로를 고를 수 있어요.",
      "정면이 막히면 옆길로 돌아가라는 뜻을 한 줄로 전해 보세요.",
    ],
  },
];

const ACTIONS = new Set<Action>(["advance", "jump", "duck", "detour"]);
const STAGE_IDS = new Set<OnboardingStageId>(
  ONBOARDING_STAGES.map((stage) => stage.id),
);

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNarrativeChoice(value: unknown): value is NarrativeChoice {
  return value === "unseen" || value === "read" || value === "skipped";
}

function reachesPhysicalGoal(
  stageId: OnboardingStageId,
  action: Action,
): boolean {
  switch (stageId) {
    case "first-step":
      // The existing flat-ground physics lets these three poses continue to
      // the door; detour needs a connected side path.
      return action === "advance" || action === "jump" || action === "duck";
    case "single-gap":
      return action === "jump";
    case "low-arch":
      return action === "duck";
    case "side-path":
      return action === "detour";
  }
}

export function isOnboardingProgress(
  value: unknown,
): value is OnboardingProgress {
  if (
    !isRecord(value) ||
    value.version !== ONBOARDING_VERSION ||
    typeof value.ownerRunId !== "string" ||
    !value.ownerRunId ||
    !isNarrativeChoice(value.narrative) ||
    !Number.isInteger(value.currentStage) ||
    (value.currentStage as number) < 0 ||
    (value.currentStage as number) > ONBOARDING_STAGES.length ||
    !Array.isArray(value.completedStageIds) ||
    !Array.isArray(value.attempts) ||
    (value.handedOffRunId !== null &&
      (typeof value.handedOffRunId !== "string" || !value.handedOffRunId))
  ) {
    return false;
  }

  if (value.handedOffRunId !== null && value.currentStage !== ONBOARDING_STAGES.length) return false;

  const completed = value.completedStageIds;
  if (
    completed.length !== value.currentStage ||
    !completed.every(
      (id, index) => id === ONBOARDING_STAGES[index]?.id && STAGE_IDS.has(id),
    )
  ) {
    return false;
  }

  return value.attempts.every(
    (attempt, index) =>
      isRecord(attempt) &&
      attempt.sequence === index + 1 &&
      STAGE_IDS.has(attempt.stageId as OnboardingStageId) &&
      typeof attempt.text === "string" &&
      attempt.text.trim() === attempt.text &&
      attempt.text.length > 0 &&
      [...attempt.text].length <= CONFIG.maxInstructionLength &&
      ACTIONS.has(attempt.action as Action) &&
      typeof attempt.applied === "boolean" &&
      typeof attempt.succeeded === "boolean",
  );
}

export function createOnboardingProgress(ownerRunId: string): OnboardingProgress {
  if (!ownerRunId) throw new Error("도입 기록의 모험 ID가 필요해요.");
  return {
    version: ONBOARDING_VERSION,
    ownerRunId,
    narrative: "unseen",
    currentStage: 0,
    completedStageIds: [],
    attempts: [],
    handedOffRunId: null,
  };
}

export function chooseNarrative(
  progress: OnboardingProgress,
  choice: Exclude<NarrativeChoice, "unseen">,
): OnboardingProgress {
  return { ...progress, narrative: choice };
}

export function isOnboardingComplete(progress: OnboardingProgress): boolean {
  return progress.currentStage === ONBOARDING_STAGES.length;
}

export function attemptOnboarding(
  progress: OnboardingProgress,
  rawText: string,
  interpretation: Interpretation,
): OnboardingAttemptResult {
  if (isOnboardingComplete(progress)) {
    throw new Error("정식 도입을 이미 마쳤어요.");
  }
  const text = rawText.trim();
  if (!text) throw new Error("용사에게 남길 한 줄을 적어 주세요.");
  if ([...text].length > CONFIG.maxInstructionLength) {
    throw new Error(`한 줄은 ${CONFIG.maxInstructionLength}자까지 쓸 수 있어요.`);
  }
  if (!ACTIONS.has(interpretation.action)) {
    throw new Error("현재 던전에서 실행할 수 없는 행동이에요.");
  }

  const stage = ONBOARDING_STAGES[progress.currentStage];
  const applies = interpretation.appliesTo.some((observation) =>
    stage.observationIds.includes(observation),
  );
  const action = interpretation.action;
  const succeeded = applies && reachesPhysicalGoal(stage.id, action);
  const attempt: OnboardingAttempt = {
    sequence: progress.attempts.length + 1,
    stageId: stage.id,
    text,
    action,
    applied: applies,
    succeeded,
  };
  const completedStageIds = succeeded
    ? [...progress.completedStageIds, stage.id]
    : progress.completedStageIds;
  const nextProgress: OnboardingProgress = {
    ...progress,
    currentStage: succeeded
      ? progress.currentStage + 1
      : progress.currentStage,
    completedStageIds,
    attempts: [...progress.attempts, attempt],
  };

  const failureMessages: Record<OnboardingStageId, Partial<Record<Action, string>>> = {
    "first-step": {
      jump: "용사가 제자리에서 뛰었지만 문턱에는 닿지 않았어요.",
      duck: "용사가 몸을 낮췄지만 문까지 움직이지 않았어요.",
      detour: "돌길 옆에는 이어진 다른 길이 없어 출발점에 머물렀어요.",
    },
    "single-gap": {
      advance: "용사가 틈 아래 쿠션에 내려앉아, 틈 앞자리로 돌아왔어요.",
      duck: "몸을 낮춰도 바닥 틈은 이어지지 않아 출발점에 머물렀어요.",
      detour: "옆길이 없어 용사가 틈 앞에서 멈췄어요.",
    },
    "low-arch": {
      advance: "용사가 둥근 아치 앞에서 멈췄어요. 다치지 않고 제자리로 돌아왔어요.",
      jump: "몸이 더 높아져 아치 앞에서 멈췄어요. 다치지 않고 제자리로 돌아왔어요.",
      detour: "아치 곁에는 이어진 다른 길이 없어 제자리로 돌아왔어요.",
    },
    "side-path": {
      advance: "용사가 두꺼운 돌벽 앞에서 멈췄어요.",
      jump: "벽은 뛰어넘기에는 너무 높아 용사가 안전하게 내려왔어요.",
      duck: "벽 아래로 난 틈이 없어 용사가 제자리로 돌아왔어요.",
    },
  };

  return {
    progress: nextProgress,
    attempt,
    message: succeeded
      ? `${stage.goal} 목표를 몸으로 해냈어요.`
      : !applies
        ? "쓴 조건이 지금 장면에는 맞지 않아 용사가 안전하게 기다렸어요. 같은 자리에서 무료로 고칠 수 있어요."
        : (failureMessages[stage.id][action] ??
          "문에는 닿지 못했어요. 같은 자리에서 한 줄을 무료로 고칠 수 있어요."),
  };
}

export function attachOnboardingHandoff(
  progress: OnboardingProgress,
  runId: string,
): OnboardingProgress {
  if (!isOnboardingComplete(progress)) {
    throw new Error("네 개의 정식 도입을 마친 뒤 본편으로 갈 수 있어요.");
  }
  if (!runId) throw new Error("본편 모험 ID가 필요해요.");
  return { ...progress, handedOffRunId: runId };
}

export function progressBelongsToRun(
  progress: OnboardingProgress | null,
  runId: string,
): boolean {
  return (
    progress?.ownerRunId === runId || progress?.handedOffRunId === runId
  );
}

export function loadOnboardingProgress(
  storage: StorageLike | null = defaultStorage(),
): OnboardingProgress | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isOnboardingProgress(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeOnboardingProgress(
  progress: OnboardingProgress,
  storage: StorageLike | null = defaultStorage(),
): StorageResult<void> {
  if (!isOnboardingProgress(progress)) {
    return {
      ok: false,
      error: { code: "semantic", message: "도입 기록의 형식이 올바르지 않아요." },
    };
  }
  if (!storage) {
    return {
      ok: false,
      error: { code: "unavailable", message: "도입 기록을 저장할 공간이 없어요." },
    };
  }
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
    return { ok: true, value: undefined };
  } catch (cause) {
    return {
      ok: false,
      error: { code: "write", message: "도입 기록을 저장하지 못했어요.", cause },
    };
  }
}
