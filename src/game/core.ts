import { roomsForRun, isRetiredChapterTail } from "./chapter-layout";
import {
  CONFIG,
  OBSERVATIONS,
  RULES_VERSION,
} from "./content";
import { copyInstruction, getRunHistory } from "./history";
import {
  appendMemory,
  consumeMemoryWrite,
  deleteMemory,
  grantMemoryWrite,
  moveMemory,
  placeMemory,
} from "./memory";
import type {
  Action,
  ExecutionEvent,
  HistoryEntry,
  Instruction,
  Interpretation,
  Observation,
  ObservationId,
  Outcome,
  RunState,
} from "./types";

const RUN_PREFIX = "run";
const ACTIONS = new Set<Action>(["advance", "jump", "duck", "detour"]);
const OBSERVATION_IDS = new Set<ObservationId>(
  Object.keys(OBSERVATIONS) as ObservationId[],
);
// The API rejects any result below 0.6 applicability certainty, so accepted uncertainty is at most 0.4.
const MAX_ACCEPTED_UNCERTAINTY = 0.4;

function createId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function bump(state: RunState, patch: Partial<RunState>): RunState {
  return { ...state, ...patch, revision: state.revision + 1 };
}

function recordTransition(
  state: RunState,
  patch: Partial<RunState>,
  makeEntry: (revision: number) => HistoryEntry,
): RunState {
  const revision = state.revision + 1;
  const history = getRunHistory(state);
  return {
    ...state,
    ...patch,
    revision,
    history: {
      ...history,
      entries: [...history.entries, makeEntry(revision)],
    },
  };
}

function pointsFor(state: RunState): ObservationId[] {
  return roomsForRun(state)[state.room]?.points ?? ["clear"];
}

function observationAt(state: RunState): ObservationId {
  return pointsFor(state)[state.point] ?? "clear";
}

function applicableInstruction(
  state: RunState,
  observation: ObservationId,
): Instruction | undefined {
  for (let index = state.instructions.length - 1; index >= 0; index -= 1) {
    const instruction = state.instructions[index];
    if (instruction.interpretation.appliesTo.includes(observation))
      return instruction;
  }
  return undefined;
}

function outcomeFor(observation: Observation, action: Action): Outcome {
  if (action === "detour") return observation.sidePath ? "safe" : "blocked";
  if (
    observation.sidePath &&
    (observation.pit || observation.floorSpikes) &&
    observation.ceilingSpikes
  ) {
    return "death";
  }
  if (observation.pit || observation.floorSpikes)
    return action === "jump" ? "safe" : "death";
  if (observation.ceilingSpikes) return action === "duck" ? "safe" : "death";
  return "safe";
}

function reasonFor(
  observation: Observation,
  action: Action,
  outcome: Outcome,
): string {
  if (outcome === "safe") {
    if (action === "detour") return "표지판을 따라 안전한 샛길로 지나갔다.";
    if (action === "jump") return "위험물을 뛰어넘었다.";
    if (action === "duck") return "몸을 낮춰 천장 가시를 피했다.";
    return "앞으로 안전하게 나아갔다.";
  }
  if (outcome === "blocked") return "표시된 샛길이 없어 더 진행할 수 없다.";
  if (observation.pit && action !== "jump")
    return "구덩이를 넘지 못하고 아래로 떨어졌다.";
  if (observation.floorSpikes && action !== "jump")
    return "바닥 가시를 피하지 못했다.";
  if (observation.ceilingSpikes && action !== "duck")
    return "낮은 천장 가시에 부딪혔다.";
  return "서로 겹친 위험물을 피하지 못했다.";
}

function signature(
  room: number,
  observation: ObservationId,
  action: Action,
  instructionId: string,
): string {
  return `${room}:${observation}:${action}:${instructionId}`;
}

function assertValidInterpretation(interpretation: Interpretation): void {
  if (
    !ACTIONS.has(interpretation.action) ||
    !Array.isArray(interpretation.appliesTo) ||
    interpretation.appliesTo.some((id) => !OBSERVATION_IDS.has(id)) ||
    new Set(interpretation.appliesTo).size !==
      interpretation.appliesTo.length ||
    !Number.isFinite(interpretation.uncertainty) ||
    interpretation.uncertainty < 0 ||
    interpretation.uncertainty > MAX_ACCEPTED_UNCERTAINTY ||
    typeof interpretation.model !== "string" ||
    !interpretation.model.trim() ||
    interpretation.rulesVersion !== RULES_VERSION
  ) {
    throw new Error(
      "AI 해석 결과가 현재 게임 규칙과 맞지 않아요. 문장을 다시 해석해 주세요.",
    );
  }
}

function hasSameAppliesTo(
  left: ObservationId[],
  right: ObservationId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((observation) => right.includes(observation))
  );
}

/** One notebook from the first step through all six rooms. */
export function newChapterRun(): RunState {
  return {
    id: createId(RUN_PREFIX),
    phase: "ready",
    tutorial: false,
    layoutVersion: 3,
    tutorialStep: 0,
    instructions: [],
    room: 0,
    point: 0,
    deaths: 0,
    penaltyDeaths: 0,
    erasers: CONFIG.initialErasers,
    canWrite: true,
    events: [],
    seen: [],
    lastEvent: null,
    revision: 0,
    history: {
      version: 1,
      complete: true,
      initialInstructions: [],
      entries: [],
    },
  };
}

/**
 * A v2 player who already crossed the final bridge has met the corrected goal.
 * Preserve all recorded actions/costs; finish without replaying or inventing an action.
 * This is an explicit commit by the UI, never a mutation during save validation.
 */
export function finishRetiredChapterTail(state: RunState): RunState {
  if (!isRetiredChapterTail(state) || state.phase === "cleared") return state;
  if (!state.events.some(event => event.room === 5 && event.point === 0 && event.outcome === "safe")) return state;
  return bump(state, { phase: "cleared", point: roomsForRun(state)[5].points.length, canWrite: false });
}

export function currentObservation(state: RunState): Observation {
  if (
    state.lastEvent &&
    ((state.phase === "dead" && state.lastEvent.outcome !== "safe") ||
      (state.phase === "blocked" && state.lastEvent.outcome === "blocked"))
  ) {
    return OBSERVATIONS[state.lastEvent.observation];
  }
  return OBSERVATIONS[observationAt(state)];
}

export function addInstruction(
  state: RunState,
  text: string,
  interpretation: Interpretation,
): RunState {
  const normalized = text.trim();
  if (!state.canWrite || (state.phase !== "ready" && state.phase !== "dead"))
    return state;
  if (!normalized) throw new Error("용사에게 남길 한 줄을 적어 주세요.");
  if ([...normalized].length > CONFIG.maxInstructionLength)
    throw new Error("한 줄은 80자까지 쓸 수 있어요.");
  assertValidInterpretation(interpretation);

  const conflictingInstruction = state.instructions.find(
    (instruction) =>
      instruction.interpretation.action !== interpretation.action &&
      hasSameAppliesTo(
        instruction.interpretation.appliesTo,
        interpretation.appliesTo,
      ),
  );
  if (conflictingInstruction) {
    throw new Error(
      `기존 메모 “${conflictingInstruction.text}”와 조건이 같지만 행동이 달라요. 조건을 바꾸거나 기존 메모를 지워 주세요.`,
    );
  }

  const nextRevision = state.revision + 1;
  const instruction: Instruction = {
    id: `${state.id}-instruction-${nextRevision}`,
    text: normalized,
    interpretation: {
      ...interpretation,
      appliesTo: [...interpretation.appliesTo],
    },
    createdAt: nextRevision,
  };
  const memory = appendMemory(state, instruction);
  return recordTransition(
    state,
    {
      instructions: memory.instructions,
      canWrite: memory.canWrite,
    },
    (revision) => ({
      kind: "write",
      revision,
      life: state.deaths + 1,
      instruction: copyInstruction(instruction),
    }),
  );
}

/** Moves one instruction by one slot. "up" means a larger index and higher priority. */
export function moveInstruction(
  state: RunState,
  instructionId: string,
  direction: "up" | "down",
): RunState {
  if (state.phase !== "ready" && state.phase !== "dead") return state;

  const index = state.instructions.findIndex((instruction) => instruction.id === instructionId);
  if (index < 0) return state;
  const moved = moveMemory<Instruction, RunState>(state, instructionId, direction, (instruction) => instruction.id);
  if (moved === state) return state;
  const targetIndex = moved.instructions.findIndex((instruction) => instruction.id === instructionId);
  return recordTransition(state, { instructions: moved.instructions }, (revision) => ({
    kind: "reorder",
    revision,
    life: state.deaths + 1,
    instructionId,
    instructionText: state.instructions[index].text,
    from: state.instructions.length - 1 - index,
    to: state.instructions.length - 1 - targetIndex,
  }));
}

/** Places one instruction around another using the high-to-low order shown in the UI. */
export function placeInstruction(
  state: RunState,
  instructionId: string,
  targetId: string,
  position: "before" | "after",
): RunState {
  if (state.phase !== "ready" && state.phase !== "dead") return state;
  if (instructionId === targetId) return state;

  const instruction = state.instructions.find((item) => item.id === instructionId);
  if (!instruction) return state;
  const placed = placeMemory<Instruction, RunState>(state, instructionId, targetId, position, (item) => item.id);
  if (placed === state) return state;
  const instructions = placed.instructions;
  const sourceIndex = state.instructions.findIndex(
    (item) => item.id === instructionId,
  );
  const destinationIndex = instructions.findIndex(
    (item) => item.id === instructionId,
  );
  return recordTransition(state, { instructions }, (revision) => ({
    kind: "reorder",
    revision,
    life: state.deaths + 1,
    instructionId,
    instructionText: instruction.text,
    from: state.instructions.length - 1 - sourceIndex,
    to: instructions.length - 1 - destinationIndex,
  }));
}

export function startRun(state: RunState): RunState {
  if (state.phase !== "ready") return state;
  const memory = consumeMemoryWrite(state);
  return bump(state, { phase: "running", canWrite: memory.canWrite, lastEvent: null });
}

/** Commits exactly one judgment. Animation code may present lastEvent after this transition. */
export function step(state: RunState): RunState {
  if (state.phase !== "running") return state;
  const completedTail = finishRetiredChapterTail(state);
  if (completedTail !== state) return completedTail;

  const observationId = observationAt(state);
  const observation = OBSERVATIONS[observationId];
  const instruction = applicableInstruction(state, observationId);
  // No matching instruction means the hero waits here. Nothing was executed,
  // so there is no action event, learned signature, movement, or death.
  if (!instruction) return bump(state, { phase: "blocked", canWrite: false });
  const action = instruction.interpretation.action;
  const outcome = outcomeFor(observation, action);
  const eventSignature = signature(
    state.room,
    observationId,
    action,
    instruction.id,
  );
  const event: ExecutionEvent = {
    id: `${state.id}-event-${state.events.length + 1}`,
    room: state.room,
    point: state.point,
    observation: observationId,
    action,
    instructionId: instruction.id,
    instructionText: instruction.text,
    outcome,
    reason: reasonFor(observation, action, outcome),
    repeated: state.seen.includes(eventSignature),
  };
  const eventPatch = {
    events: [...state.events, event],
    seen: state.seen.includes(eventSignature)
      ? state.seen
      : [...state.seen, eventSignature],
    lastEvent: event,
  };

  if (outcome === "death") {
    return recordTransition(
      state,
      {
        ...eventPatch,
        phase: "dead",
        deaths: state.deaths + 1,
        canWrite: grantMemoryWrite(state).canWrite,
      },
      (revision) => ({
        kind: "action",
        revision,
        life: state.deaths + 1,
        eventId: event.id,
      }),
    );
  }
  if (outcome === "blocked") {
    return recordTransition(
      state,
      { ...eventPatch, phase: "blocked", canWrite: false },
      (revision) => ({
        kind: "action",
        revision,
        life: state.deaths + 1,
        eventId: event.id,
      }),
    );
  }

  const roomPoints = pointsFor(state);
  let room = state.room;
  let point = state.point + 1;
  let phase: RunState["phase"] = "running";

  if (point >= roomPoints.length || isRetiredChapterTail({ ...state, point })) {
    if (room >= roomsForRun(state).length - 1) {
      phase = "cleared";
      point = roomPoints.length;
    } else {
      room += 1;
      point = 0;
    }
  }
  const memory = consumeMemoryWrite(state);
  return recordTransition(
    state,
    {
      ...eventPatch,
      room,
      point,
      phase,
      canWrite: memory.canWrite,
    },
    (revision) => ({
      kind: "action",
      revision,
      life: state.deaths + 1,
      eventId: event.id,
    }),
  );
}

/** Returns to the dungeon entrance. The unused writing chance expires here. */
export function retry(state: RunState): RunState {
  if (state.phase !== "dead") return state;
  const memory = consumeMemoryWrite(state);
  return recordTransition(
    state,
    {
      phase: "ready",
      room: 0,
      point: 0,
      canWrite: memory.canWrite,
    },
    (revision) => ({
      kind: "revive",
      revision,
      life: state.deaths + 1,
    }),
  );
}

/** Deletes and charges in one immutable transition. */
export function deleteInstruction(
  state: RunState,
  instructionId: string,
): RunState {
  if (state.phase !== "dead") return state;
  const index = state.instructions.findIndex(
    (instruction) => instruction.id === instructionId,
  );
  if (index < 0) return state;

  const deleted = deleteMemory<Instruction, RunState>(state, instructionId, (instruction) => instruction.id);
  return recordTransition(
    state,
    {
      instructions: deleted.state.instructions,
      erasers: deleted.state.erasers,
      penaltyDeaths: deleted.state.penaltyDeaths,
    },
    (revision) => ({
      kind: "delete",
      revision,
      life: state.deaths + 1,
      instructionId,
      instructionText: state.instructions[index].text,
      eraserCost: deleted.eraserCost,
      deathCost: deleted.deathCost,
    }),
  );
}

/** A blocked run can only be restarted by accepting one death. */
export function abandon(state: RunState): RunState {
  if (state.phase !== "blocked") return state;
  return recordTransition(
    state,
    {
      phase: "dead",
      deaths: state.deaths + 1,
      canWrite: grantMemoryWrite(state).canWrite,
    },
    (revision) => ({
      kind: "abandon",
      revision,
      life: state.deaths + 1,
    }),
  );
}

export function score(state: RunState): number {
  return state.deaths + state.penaltyDeaths;
}
