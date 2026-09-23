import {
  CONFIG,
  DUNGEON_VERSION,
  GAME_VERSION,
  OBSERVATIONS,
  RULES_VERSION,
  TUTORIAL_ROOM,
} from "./content";
import { roomsForRun } from "./chapter-layout";
import type {
  Action,
  ExecutionEvent,
  Instruction,
  ObservationId,
  RunState,
  SaveData,
  Settings,
} from "./types";

export const STORAGE_KEY = "one-line-per-death:save";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StorageErrorCode =
  | "unavailable"
  | "read"
  | "write"
  | "damaged"
  | "schema"
  | "incompatible"
  | "semantic"
  | "conflict";

export interface StorageError {
  code: StorageErrorCode;
  message: string;
  cause?: unknown;
}

export type StorageResult<T> =
  { ok: true; value: T } | { ok: false; error: StorageError };

export interface SaveStamp {
  writer: string;
  revision: number;
}

export interface WriteOptions {
  storage?: StorageLike;
  /** null means the caller expects no prior save; omitted uses same-writer protection. */
  expected?: SaveStamp | null;
}

export interface MakeSaveOptions {
  writer: string;
  settings?: Settings;
  tutorialCompleted?: boolean;
  best?: number | null;
  savedAt?: number;
}

const ACTIONS = new Set<Action>(["advance", "jump", "duck", "detour"]);
const OBSERVATION_IDS = new Set<ObservationId>(
  Object.keys(OBSERVATIONS) as ObservationId[],
);
const OUTCOMES = new Set(["safe", "death", "blocked"]);
const PHASES = new Set([
  "title",
  "ready",
  "running",
  "dead",
  "blocked",
  "practice",
  "cleared",
]);
const MAX_ACCEPTED_UNCERTAINTY = 0.4;

function characterCount(value: string): number {
  return [...value].length;
}

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

function isInteger(value: unknown, minimum = 0): value is number {
  return Number.isInteger(value) && (value as number) >= minimum;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validInterpretation(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !ACTIONS.has(value.action as Action) ||
    !Array.isArray(value.appliesTo)
  )
    return false;
  if (!value.appliesTo.every((id) => OBSERVATION_IDS.has(id as ObservationId)))
    return false;
  if (new Set(value.appliesTo).size !== value.appliesTo.length) return false;
  return (
    typeof value.uncertainty === "number" &&
    Number.isFinite(value.uncertainty) &&
    value.uncertainty >= 0 &&
    value.uncertainty <= MAX_ACCEPTED_UNCERTAINTY &&
    isNonEmptyString(value.model) &&
    value.model.trim().length > 0 &&
    value.rulesVersion === RULES_VERSION
  );
}

function validInstruction(value: unknown): value is Instruction {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.text) &&
    characterCount(value.text) <= 80 &&
    isInteger(value.createdAt) &&
    validInterpretation(value.interpretation)
  );
}

function validEvent(value: unknown): value is ExecutionEvent {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isInteger(value.room) &&
    isInteger(value.point) &&
    OBSERVATION_IDS.has(value.observation as ObservationId) &&
    ACTIONS.has(value.action as Action) &&
    (value.instructionId === null || isNonEmptyString(value.instructionId)) &&
    (value.instructionText === undefined ||
      value.instructionText === null ||
      (isNonEmptyString(value.instructionText) &&
        characterCount(value.instructionText) <= 80)) &&
    OUTCOMES.has(value.outcome as string) &&
    typeof value.reason === "string" &&
    typeof value.repeated === "boolean"
  );
}

function sameEvent(left: ExecutionEvent, right: ExecutionEvent): boolean {
  return (
    left.id === right.id &&
    left.room === right.room &&
    left.point === right.point &&
    left.observation === right.observation &&
    left.action === right.action &&
    left.instructionId === right.instructionId &&
    left.instructionText === right.instructionText &&
    left.outcome === right.outcome &&
    left.reason === right.reason &&
    left.repeated === right.repeated
  );
}

function validHistory(value: unknown, state: RunState): boolean {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.complete !== "boolean" ||
    !Array.isArray(value.initialInstructions) ||
    !value.initialInstructions.every(validInstruction) ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }

  const initialInstructions = value.initialInstructions as Instruction[];
  const knownInstructions = new Map<string, Instruction>();
  for (const instruction of initialInstructions) {
    if (knownInstructions.has(instruction.id)) return false;
    knownInstructions.set(instruction.id, instruction);
  }

  const activeHighToLow = [...initialInstructions].reverse();
  let previousRevision = 0;
  let eventIndex = 0;

  for (const rawEntry of value.entries) {
    if (
      !isRecord(rawEntry) ||
      !isInteger(rawEntry.revision, 1) ||
      rawEntry.revision <= previousRevision ||
      rawEntry.revision > state.revision ||
      !isInteger(rawEntry.life, 1) ||
      rawEntry.life > state.deaths + 1 ||
      typeof rawEntry.kind !== "string"
    ) {
      return false;
    }
    previousRevision = rawEntry.revision;

    if (rawEntry.kind === "write") {
      if (!validInstruction(rawEntry.instruction)) return false;
      const instruction = rawEntry.instruction;
      if (knownInstructions.has(instruction.id)) return false;
      knownInstructions.set(instruction.id, instruction);
      activeHighToLow.unshift(instruction);
      continue;
    }

    if (rawEntry.kind === "delete") {
      if (
        !isNonEmptyString(rawEntry.instructionId) ||
        !isNonEmptyString(rawEntry.instructionText) ||
        !isInteger(rawEntry.eraserCost) ||
        !isInteger(rawEntry.deathCost) ||
        !(
          (rawEntry.eraserCost === 1 && rawEntry.deathCost === 0) ||
          (rawEntry.eraserCost === 0 &&
            rawEntry.deathCost === CONFIG.deletionPenalty)
        )
      ) {
        return false;
      }
      const known = knownInstructions.get(rawEntry.instructionId);
      const activeIndex = activeHighToLow.findIndex(
        (instruction) => instruction.id === rawEntry.instructionId,
      );
      if (
        !known ||
        known.text !== rawEntry.instructionText ||
        activeIndex < 0
      ) {
        return false;
      }
      activeHighToLow.splice(activeIndex, 1);
      continue;
    }

    if (rawEntry.kind === "reorder") {
      if (
        !isNonEmptyString(rawEntry.instructionId) ||
        !isNonEmptyString(rawEntry.instructionText) ||
        !isInteger(rawEntry.from) ||
        !isInteger(rawEntry.to) ||
        rawEntry.from >= activeHighToLow.length ||
        rawEntry.to >= activeHighToLow.length ||
        rawEntry.from === rawEntry.to
      ) {
        return false;
      }
      const known = knownInstructions.get(rawEntry.instructionId);
      if (
        !known ||
        known.text !== rawEntry.instructionText ||
        activeHighToLow[rawEntry.from]?.id !== rawEntry.instructionId
      ) {
        return false;
      }
      const [instruction] = activeHighToLow.splice(rawEntry.from, 1);
      activeHighToLow.splice(rawEntry.to, 0, instruction);
      continue;
    }

    if (rawEntry.kind === "action") {
      if (
        !isNonEmptyString(rawEntry.eventId) ||
        state.events[eventIndex]?.id !== rawEntry.eventId
      ) {
        return false;
      }
      eventIndex += 1;
      continue;
    }

    if (rawEntry.kind !== "revive" && rawEntry.kind !== "abandon") {
      return false;
    }
  }

  const currentHighToLow = [...state.instructions].reverse();
  return (
    eventIndex === state.events.length &&
    activeHighToLow.length === currentHighToLow.length &&
    activeHighToLow.every(
      (instruction, index) =>
        instruction.id === currentHighToLow[index]?.id &&
        instruction.text === currentHighToLow[index]?.text,
    )
  );
}

function validState(value: unknown): value is RunState {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !PHASES.has(value.phase as string)
  )
    return false;
  if (typeof value.tutorial !== "boolean" || !isInteger(value.tutorialStep))
    return false;
  if (value.layoutVersion !== undefined && value.layoutVersion !== 1 && value.layoutVersion !== 2)
    return false;
  if (value.tutorial && value.layoutVersion === 2) return false;
  if (
    !Array.isArray(value.instructions) ||
    !value.instructions.every(validInstruction)
  )
    return false;
  const instructionIds = value.instructions.map(
    (instruction) => instruction.id,
  );
  if (new Set(instructionIds).size !== instructionIds.length) return false;
  if (
    !isInteger(value.room) ||
    !isInteger(value.point) ||
    !isInteger(value.deaths) ||
    !isInteger(value.penaltyDeaths) ||
    !isInteger(value.erasers) ||
    !isInteger(value.revision)
  )
    return false;
  if (
    value.erasers > CONFIG.initialErasers ||
    value.penaltyDeaths % CONFIG.deletionPenalty !== 0
  )
    return false;
  if (
    typeof value.canWrite !== "boolean" ||
    !Array.isArray(value.events) ||
    !value.events.every(validEvent)
  )
    return false;
  if (
    !Array.isArray(value.seen) ||
    !value.seen.every((item) => typeof item === "string")
  )
    return false;
  if (value.lastEvent !== null && !validEvent(value.lastEvent)) return false;
  const lastEvent = value.lastEvent as ExecutionEvent | null;
  if (new Set(value.seen).size !== value.seen.length) return false;
  const events = value.events as ExecutionEvent[];
  const eventIds = events.map((event) => event.id);
  if (new Set(eventIds).size !== eventIds.length) return false;
  if (
    lastEvent !== null &&
    (!events.at(-1) || !sameEvent(events.at(-1)!, lastEvent))
  )
    return false;
  if (value.canWrite && value.phase !== "ready" && value.phase !== "dead")
    return false;
  const rooms = value.tutorial
    ? [TUTORIAL_ROOM]
    : roomsForRun({ layoutVersion: value.layoutVersion as RunState["layoutVersion"] });
  if (
    events.some((event) => {
      const point = rooms[event.room]?.points[event.point];
      return point === undefined || point !== event.observation;
    })
  )
    return false;
  if (value.tutorial) {
    if (value.room !== 0 || value.point > TUTORIAL_ROOM.points.length)
      return false;
    if (
      value.point === TUTORIAL_ROOM.points.length &&
      value.phase !== "practice"
    )
      return false;
    if (
      value.phase === "practice" &&
      (value.point !== TUTORIAL_ROOM.points.length ||
        value.instructions.length !== 2 ||
        value.tutorialStep < 5 ||
        value.tutorialStep > 8)
    )
      return false;
    if (value.phase === "cleared") return false;
  } else {
    if (value.room >= rooms.length) return false;
    const roomLength = rooms[value.room]?.points.length ?? 0;
    if (value.point > roomLength) return false;
    if (
      value.point === roomLength &&
      (value.phase !== "cleared" || value.room !== rooms.length - 1)
    )
      return false;
    if (
      value.phase === "cleared" &&
      (value.room !== rooms.length - 1 || value.point !== roomLength)
    )
      return false;
    if (value.phase === "practice") return false;
  }
  if (
    value.history !== undefined &&
    !validHistory(value.history, value as unknown as RunState)
  )
    return false;
  // A missing instruction stops the run without creating an action event.
  // Earlier safe events may remain in lastEvent, but none may describe the
  // current position, and a blocked save must still have no matching note.
  const noActionAtCurrentPoint =
    lastEvent === null ||
    (lastEvent.outcome === "safe" &&
      (lastEvent.room !== value.room || lastEvent.point !== value.point));
  const currentPoint = rooms[value.room]?.points[value.point];
  const hasMatchingInstruction =
    currentPoint !== undefined &&
    (value.instructions as Instruction[]).some((instruction) =>
      instruction.interpretation.appliesTo.includes(currentPoint),
    );
  const blockedWithoutInstruction =
    noActionAtCurrentPoint && !hasMatchingInstruction;
  const historyEntries: unknown[] = isRecord(value.history) && Array.isArray(value.history.entries)
    ? value.history.entries
    : [];
  let lastActionIndex = -1;
  let lastAbandonIndex = -1;
  let lastReviveIndex = -1;
  for (let index = 0; index < historyEntries.length; index += 1) {
    const entry = historyEntries[index];
    if (!isRecord(entry)) continue;
    if (entry.kind === "action") lastActionIndex = index;
    if (entry.kind === "abandon") lastAbandonIndex = index;
    if (entry.kind === "revive") lastReviveIndex = index;
  }
  const explicitlyAbandonedStop =
    noActionAtCurrentPoint &&
    lastAbandonIndex > Math.max(lastActionIndex, lastReviveIndex);
  if (
    value.phase === "dead" &&
    lastEvent?.outcome !== "death" &&
    lastEvent?.outcome !== "blocked" &&
    !explicitlyAbandonedStop
  )
    return false;
  if (
    value.phase === "blocked" &&
    lastEvent?.outcome !== "blocked" &&
    !blockedWithoutInstruction
  )
    return false;
  return true;
}

function validSettings(value: unknown): value is Settings {
  return (
    isRecord(value) &&
    typeof value.muted === "boolean" &&
    typeof value.reducedMotion === "boolean"
  );
}

function validateSave(value: unknown): StorageResult<SaveData> {
  if (!isRecord(value) || !("state" in value) || !("settings" in value)) {
    return failure("schema", "저장 데이터 구조가 올바르지 않습니다.");
  }
  if (
    value.gameVersion !== GAME_VERSION ||
    value.dungeonVersion !== DUNGEON_VERSION ||
    value.rulesVersion !== RULES_VERSION
  ) {
    return failure(
      "incompatible",
      "현재 게임 버전과 호환되지 않는 저장 데이터입니다.",
    );
  }
  if (!validState(value.state) || !validSettings(value.settings)) {
    return failure("semantic", "저장 데이터의 게임 상태가 유효하지 않습니다.");
  }
  if (
    typeof value.tutorialCompleted !== "boolean" ||
    !(value.best === null || isInteger(value.best)) ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    value.savedAt < 0 ||
    !isNonEmptyString(value.writer)
  ) {
    return failure("semantic", "저장 데이터 값이 유효 범위를 벗어났습니다.");
  }
  return { ok: true, value: value as unknown as SaveData };
}

function failure(
  code: StorageErrorCode,
  message: string,
  cause?: unknown,
): StorageResult<never> {
  return {
    ok: false,
    error: { code, message, ...(cause === undefined ? {} : { cause }) },
  };
}

function parseRaw(raw: string): StorageResult<SaveData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return failure(
      "damaged",
      "저장 데이터를 읽을 수 없습니다. 기존 데이터는 보존했습니다.",
      cause,
    );
  }
  return validateSave(parsed);
}

export function makeSave(state: RunState, options: MakeSaveOptions): SaveData {
  return {
    gameVersion: GAME_VERSION,
    dungeonVersion: DUNGEON_VERSION,
    rulesVersion: RULES_VERSION,
    state,
    settings: options.settings ?? { muted: false, reducedMotion: false },
    tutorialCompleted: options.tutorialCompleted ?? false,
    best: options.best ?? null,
    savedAt: options.savedAt ?? Date.now(),
    writer: options.writer,
  };
}

export function loadSave(
  storage: StorageLike | null = defaultStorage(),
): StorageResult<SaveData | null> {
  if (!storage)
    return failure(
      "unavailable",
      "이 브라우저에서는 저장소를 사용할 수 없습니다.",
    );
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (cause) {
    return failure("read", "저장 데이터를 읽지 못했습니다.", cause);
  }
  if (raw === null) return { ok: true, value: null };
  return parseRaw(raw);
}

export function writeSave(
  data: SaveData,
  options: WriteOptions = {},
): StorageResult<SaveData> {
  const storage = options.storage ?? defaultStorage();
  if (!storage)
    return failure(
      "unavailable",
      "이 브라우저에서는 저장소를 사용할 수 없습니다.",
    );
  const incoming = validateSave(data);
  if (!incoming.ok) return incoming;

  let currentRaw: string | null;
  try {
    currentRaw = storage.getItem(STORAGE_KEY);
  } catch (cause) {
    return failure("read", "기존 저장 데이터를 확인하지 못했습니다.", cause);
  }

  if (currentRaw !== null) {
    const current = parseRaw(currentRaw);
    if (!current.ok) return current;
    if (options.expected === null) {
      return failure(
        "conflict",
        "예상하지 못한 기존 저장 데이터가 있어 덮어쓰지 않았습니다.",
      );
    }
    if (options.expected !== undefined) {
      if (
        current.value.writer !== options.expected.writer ||
        current.value.state.revision !== options.expected.revision
      ) {
        return failure(
          "conflict",
          "다른 탭에서 저장 데이터가 변경되어 덮어쓰지 않았습니다.",
        );
      }
    } else if (current.value.writer !== data.writer) {
      return failure(
        "conflict",
        "다른 탭이 작성한 저장 데이터가 있어 덮어쓰지 않았습니다.",
      );
    } else if (data.state.revision < current.value.state.revision) {
      return failure(
        "conflict",
        "더 오래된 상태로 최신 저장 데이터를 덮어쓸 수 없습니다.",
      );
    }
  } else if (options.expected !== undefined && options.expected !== null) {
    return failure(
      "conflict",
      "기대했던 기존 저장 데이터가 없어 저장을 중단했습니다.",
    );
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (cause) {
    return failure("write", "게임 상태를 저장하지 못했습니다.", cause);
  }
  return { ok: true, value: data };
}
