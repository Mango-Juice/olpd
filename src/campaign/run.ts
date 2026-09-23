import {
  createNotebook,
  deleteProgram,
  departNotebook,
  killNotebook,
  moveProgram,
  placeProgram,
  retryNotebook,
  writeProgram,
  type Notebook,
} from "./notebook";
import { createExecution, enterEncounter, scheduleStep, type ExecutionState } from "./scheduler";
import type { ActionExecutor, ActionResult } from "./program";
import type { InstructionProgram, PhysicalAction, StageId, WorldEvent, WorldState } from "./types";
import type { CampaignStageDefinition } from "./level";

export interface StageRun {
  version: 3;
  contentRevision: "shared-v1" | "spatial-v1";
  id: string;
  stageId: StageId;
  revision: number;
  statusReason: string | null;
  waitingStates: string[];
  phase: "bookmark" | "running" | "waiting" | "blocked" | "failed" | "cleared";
  world: WorldState;
  checkpoint: WorldState;
  notebook: Notebook;
  execution: ExecutionState;
  events: WorldEvent[];
  clearedSegments: string[];
  seal: number;
  history: CampaignRunHistory;
  presentation: StagePresentation | null;
  presentationHistory: StagePresentation[];
}

export type CampaignHistoryEntry =
  | { kind: "write"; revision: number; life: number; instruction: InstructionProgram }
  | { kind: "delete"; revision: number; life: number; instructionId: string; instructionText: string; eraserCost: number; deathCost: number }
  | { kind: "reorder"; revision: number; life: number; instructionId: string; instructionText: string; from: number; to: number }
  | { kind: "action"; revision: number; life: number; eventIds: string[] }
  | { kind: "revive"; revision: number; life: number }
  | { kind: "abandon"; revision: number; life: number };

export interface CampaignRunHistory {
  version: 1;
  initialInstructions: InstructionProgram[];
  entries: CampaignHistoryEntry[];
}

export interface StagePresentation {
  id: string;
  before: WorldState;
  after: WorldState;
  events: WorldEvent[];
  outcome: "safe" | "death" | "blocked" | "revive" | "cleared";
  repeated: boolean;
  life: number;
  attempt: number;
  completedSegmentId?: string;
  nextSegmentId?: string;
}

export function createStageRun(id: string, initial: WorldState, contentRevision: StageRun['contentRevision'] = "shared-v1"): StageRun {
  if (initial.stageId === 1) throw new Error("1장은 기존 실행기를 사용해요.");
  return {
    version: 3,
    contentRevision,
    id,
    stageId: initial.stageId,
    revision: 0,
    statusReason: null,
    waitingStates: [],
    phase: "bookmark",
    world: structuredClone(initial),
    checkpoint: structuredClone(initial),
    notebook: createNotebook(),
    execution: createExecution(),
    events: [],
    clearedSegments: [],
    seal: 0,
    history: { version: 1, initialInstructions: [], entries: [] },
    presentation: null,
    presentationHistory: [],
  };
}
/** Starts a new campaign with the notebook contract owned by its content revision. */
export function createCampaignRun(id: string, stage: CampaignStageDefinition): StageRun {
  const first = stage.segments[0];
  if (!first) throw new Error("시작할 구간이 없어요.");
  const initial = first.enter(null);
  return createStageRun(id, initial, stage.contentRevision ?? "shared-v1");
}
export function departStage(run: StageRun): StageRun {
  if (run.phase !== "bookmark") return run;
  return { ...run, phase: "running", statusReason: null, waitingStates: [], revision: run.revision + 1, notebook: departNotebook(run.notebook) };
}

function visibleIndex(run: StageRun, id: string): number {
  const stored = run.notebook.instructions.findIndex((item) => item.id === id);
  return stored < 0 ? -1 : run.notebook.instructions.length - 1 - stored;
}

export function writeStageProgram(run: StageRun, program: InstructionProgram): StageRun {
  if ((run.phase !== "bookmark" && run.phase !== "failed") || !run.notebook.canWrite) return run;
  const notebook = writeProgram(run.notebook, program);
  const revision = run.revision + 1;
  return {
    ...run,
    revision,
    notebook,
    history: {
      ...run.history,
      entries: [...run.history.entries, {
        kind: "write",
        revision,
        life: run.notebook.deaths + 1,
        instruction: structuredClone(program),
      }],
    },
  };
}

export function deleteStageProgram(run: StageRun, instructionId: string): StageRun {
  if (run.phase !== "failed") return run;
  const instruction = run.notebook.instructions.find((item) => item.id === instructionId);
  if (!instruction) return run;
  const beforeErasers = run.notebook.erasers;
  const beforePenalty = run.notebook.penaltyDeaths;
  const notebook = deleteProgram(run.notebook, instructionId);
  const revision = run.revision + 1;
  return {
    ...run,
    revision,
    notebook,
    history: {
      ...run.history,
      entries: [...run.history.entries, {
        kind: "delete",
        revision,
        life: run.notebook.deaths + 1,
        instructionId,
        instructionText: instruction.text,
        eraserCost: beforeErasers - notebook.erasers,
        deathCost: notebook.penaltyDeaths - beforePenalty,
      }],
    },
  };
}

export function moveStageProgram(run: StageRun, instructionId: string, direction: "up" | "down"): StageRun {
  if (run.phase !== "bookmark" && run.phase !== "failed") return run;
  const from = visibleIndex(run, instructionId);
  if (from < 0) return run;
  const notebook = moveProgram(run.notebook, instructionId, direction);
  if (notebook === run.notebook) return run;
  const to = notebook.instructions.length - 1 - notebook.instructions.findIndex((item) => item.id === instructionId);
  const revision = run.revision + 1;
  const instruction = run.notebook.instructions.find((item) => item.id === instructionId)!;
  return { ...run, revision, notebook, history: { ...run.history, entries: [...run.history.entries,
    { kind: "reorder", revision, life: run.notebook.deaths + 1, instructionId, instructionText: instruction.text, from, to }] } };
}

export function placeStageProgram(run: StageRun, instructionId: string, targetId: string, position: "before" | "after"): StageRun {
  if (run.phase !== "bookmark" && run.phase !== "failed") return run;
  const from = visibleIndex(run, instructionId);
  if (from < 0) return run;
  const notebook = placeProgram(run.notebook, instructionId, targetId, position);
  if (notebook === run.notebook) return run;
  const to = notebook.instructions.length - 1 - notebook.instructions.findIndex((item) => item.id === instructionId);
  const revision = run.revision + 1;
  const instruction = run.notebook.instructions.find((item) => item.id === instructionId)!;
  return { ...run, revision, notebook, history: { ...run.history, entries: [...run.history.entries,
    { kind: "reorder", revision, life: run.notebook.deaths + 1, instructionId, instructionText: instruction.text, from, to }] } };
}

export function acknowledgePresentation(run: StageRun): StageRun {
  return run.presentation ? { ...run, revision: run.revision + 1, presentation: null } : run;
}
/** Returns after a death to the chapter entrance. The unused writing chance expires. */
export function rewindStage(run: StageRun): StageRun {
  if (run.phase !== "failed") return run;
  const before = structuredClone(run.world);
  const world = structuredClone(run.checkpoint);
  world.attempt = run.world.attempt + 1;
  const revision = run.revision + 1;
  const presentation: StagePresentation = {
    id: `${run.id}:${revision}:revive`,
    before,
    after: structuredClone(world),
    events: [],
    outcome: "revive",
    repeated: false,
    life: run.notebook.deaths + 1,
    attempt: before.attempt,
  };
  return {
    ...run,
    revision,
    phase: "bookmark",
    world,
    waitingStates: [],
    notebook: retryNotebook(run.notebook),
    execution: createExecution(),
    clearedSegments: [],
    seal: 0,
    history: { ...run.history, entries: [...run.history.entries, { kind: "revive", revision, life: run.notebook.deaths + 1 }] },
    presentation,
    presentationHistory: [...run.presentationHistory, presentation],
  };
}

export const retryStage = rewindStage;

/** A blocked run yields a writing chance only after accepting one death. */
export function abandonStage(run: StageRun): StageRun {
  if (run.phase !== "blocked") return run;
  const revision = run.revision + 1;
  const notebook = killNotebook(run.notebook);
  const presentation: StagePresentation = {
    id: `${run.id}:${revision}:abandon`,
    before: structuredClone(run.world),
    after: structuredClone(run.world),
    events: [],
    outcome: "death",
    repeated: false,
    life: run.notebook.deaths + 1,
    attempt: run.world.attempt,
  };
  return {
    ...run,
    revision,
    phase: "failed",
    notebook,
    statusReason: "막힌 길에서 돌아오기로 했어요. · +1데스",
    history: { ...run.history, entries: [...run.history.entries,
      { kind: "abandon", revision, life: run.notebook.deaths + 1 }] },
    presentation,
    presentationHistory: [...run.presentationHistory, presentation],
  };
}
export interface EnvironmentStep {
  /** Phase of periodic mechanisms, needed to distinguish a pause from a full repeated cycle. */
  waitKey?: string;
  world: WorldState;
  events: WorldEvent[];
  failure?: string;
  reason?: string;
  /** A stable environment with unmet wait is a visible deadlock, never an endless spinner. */
  canChange: boolean;
}
export interface StageDynamics {
  execute: ActionExecutor;
  advance: (world: WorldState) => EnvironmentStep;
  /** Physical goal predicates inspect the actual world, never a solution string or AI verdict. */
  segmentComplete: (world: WorldState) => boolean;
  nextSegment: (world: WorldState) => WorldState | null;
  /** Optional narrative seal marker; never changes the entrance respawn point. */
  sealAfter: (segmentId: string) => number | null;
}
export function advanceStage(run: StageRun, dynamics: StageDynamics): StageRun {
  if (run.phase !== "running" && run.phase !== "waiting") return run;
  if (run.presentation) return run;
  const before = structuredClone(run.world);
  const priorityPrograms = [...run.notebook.instructions].reverse();
  const traces: { before: WorldState; result: ActionResult }[] = [];
  const scheduled = scheduleStep(run.world, priorityPrograms, run.execution, (world, action) => {
    const before = structuredClone(world);
    const result = dynamics.execute(world, action);
    traces.push({ before, result });
    return result;
  });
  // Only player-authored actions can move an actor. A dormant or exhausted
  // notebook cannot manufacture a new walking command.
  let world = scheduled.step?.world ?? run.world;
  const events: WorldEvent[] = [];
  const instructionId = scheduled.instructionId;
  const actions = scheduled.step?.actions ?? [];
  let stepOutcome = scheduled.step?.outcome;
  let stepReason = scheduled.reason;
  const hasStep = scheduled.step !== null;
  for (const [index, action] of actions.entries()) {
    const trace = traces[index];
    const signature = replaySignature(trace.before, action, instructionId);
    const repeated = run.events.some((event) => event.signature === signature && event.outcome === "safe");
    events.push({ ...(trace.result.motion ? { motion: trace.result.motion } : {}), verb: action.verb, segmentId: trace.before.segmentId, signature, repeated, id: `${run.id}:${run.revision + 1}:${index}`, tick: world.tick, attempt: world.attempt, instructionId, actor: action.actor, target: action.target, outcome: trace.result.outcome === "done" || trace.result.outcome === "progress" ? action.verb === "observe" || action.verb === "remember" ? "observed" : "safe" : trace.result.outcome, reason: trace.result.reason, changes: worldChanges(trace.before, trace.result.world) });
  }
  if (scheduled.interrupted) events.unshift({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:interrupt`, tick: world.tick, attempt: world.attempt, instructionId: scheduled.interrupted, actor: null, target: null, outcome: "interrupted", reason: "더 높은 경계 지침을 먼저 실행하고 중단 지점을 보관했어요.", changes: [] });
  if (scheduled.step?.outcome === "clarification" && instructionId) {
    if (!events.some((event) => event.outcome === "clarification")) events.push({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:clarification`, tick: world.tick, attempt: world.attempt, instructionId, actor: null, target: null, outcome: "clarification", reason: scheduled.reason ?? "지침의 뜻을 확인해야 해요.", changes: [] });
    stepOutcome = "blocked";
    stepReason = scheduled.reason ?? "지침의 뜻을 확인하지 못해 안전한 곳에서 멈췄어요.";
  }
  // A commanded ride keeps moving after the boarding action has finished.
  // This advances the environment only; it never invents a landing/action.
  const autonomousRide = !hasStep
    && Object.values(world.actors).some((actor) => actor.riding !== null);
  let waitKey: string | undefined;
  let phase: StageRun["phase"] = stepOutcome === "failure" ? "failed" : (!hasStep && !autonomousRide) || stepOutcome === "blocked" ? "blocked" : "running";
  let statusReason = stepReason;
  if (phase === "running" && (actions.length > 0 || stepOutcome === "waiting" || autonomousRide)) {
    const beforeEnvironment = world;
    const environment = dynamics.advance(world);
    waitKey = environment.waitKey;
    world = environment.world;
    events.push(...environment.events.map((event) => ({ ...event, segmentId: event.segmentId ?? world.segmentId })));
    const changes = worldChanges(beforeEnvironment, world);
    if (changes.length > 0) events.push({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:reaction`, tick: world.tick, attempt: world.attempt, instructionId, actor: null, target: null, outcome: "observed", reason: environment.reason ?? "물체와 장치의 상태가 바뀌었어요.", changes });
    if (environment.failure) {
      phase = "failed";
      statusReason = environment.failure;
      events.push({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:environment`, tick: world.tick, attempt: world.attempt, instructionId, actor: null, target: null, outcome: "failure", reason: environment.failure, changes: [] });
    }
    // A final transition (for example cooling finishes) must be observed once
    // before deciding that a now-stable mechanism cannot satisfy the wait.
    else if (stepOutcome === "waiting" || autonomousRide) phase = environment.canChange || changes.length > 0 ? "waiting" : "blocked";
  }
  let waitingStates: string[] = [];
  if (phase === "waiting" && actions.length === 0) {
    const signature = JSON.stringify({
      segment: world.segmentId,
      clock: waitKey,
      execution: scheduled.execution,
      entities: Object.entries(world.entities).sort(([a], [b]) => a.localeCompare(b)).map(([id, entity]) => [id, entity.location, entity.parent, entity.properties]),
      actors: world.actors, visible: world.visible,
    });
    if (run.waitingStates.includes(signature)) {
      phase = "blocked";
      statusReason = "장치가 같은 상태로 되돌아왔지만 대기 조건은 이루어지지 않았어요. 현재 조건과 연결을 확인해 주세요.";
    } else waitingStates = [...run.waitingStates, signature];
  }
  if (phase === "blocked" && !events.some((event) => event.outcome === "blocked" || event.outcome === "clarification")) {
    events.push({
      segmentId: world.segmentId,
      id: `${run.id}:${run.revision + 1}:blocked`,
      tick: world.tick,
      attempt: world.attempt,
      instructionId,
      actor: null,
      target: null,
      outcome: "blocked",
      reason: statusReason ?? "현재 메모로 더 진행할 수 없어 안전한 곳에서 멈췄어요.",
      changes: [],
    });
  }
  const completedSegmentId = phase !== "failed" && dynamics.segmentComplete(world) ? world.segmentId : undefined;
  const following = completedSegmentId ? dynamics.nextSegment(world) : null;
  if (completedSegmentId && !following) phase = "cleared";
  const outcome: StagePresentation["outcome"] = phase === "failed"
    ? "death"
    : phase === "blocked"
      ? "blocked"
      : phase === "cleared"
        ? "cleared"
        : "safe";
  const revision = run.revision + 1;
  const actionEvents = events.filter((event) => event.actor !== null && event.outcome === "safe");
  const presentation: StagePresentation = {
    id: `${run.id}:${revision}:presentation`,
    before,
    after: structuredClone(world),
    events: structuredClone(events),
    outcome,
    repeated: actionEvents.length > 0 && actionEvents.every((event) => event.repeated === true),
    life: run.notebook.deaths + 1,
    attempt: before.attempt,
    ...(completedSegmentId ? { completedSegmentId } : {}),
    ...(following ? { nextSegmentId: following.segmentId } : {}),
  };
  let notebook = phase === "failed" ? killNotebook(run.notebook) : run.notebook;
  let execution = phase === "failed" || phase === "blocked" || phase === "cleared" ? createExecution() : scheduled.execution;
  let nextWorld = world;
  let clearedSegments = run.clearedSegments;
  let seal = run.seal;
  if (completedSegmentId) {
    clearedSegments = [...run.clearedSegments, completedSegmentId];
    if (following) {
      nextWorld = following;
      execution = enterEncounter(scheduled.execution);
      phase = "running";
      statusReason = null;
      waitingStates = [];
      seal = dynamics.sealAfter(completedSegmentId) ?? seal;
    }
  }
  return {
    ...run,
    waitingStates,
    revision,
    world: nextWorld,
    phase,
    statusReason,
    execution,
    notebook,
    events: [...run.events, ...events],
    clearedSegments,
    seal,
    history: {
      ...run.history,
      entries: [...run.history.entries, {
        kind: "action",
        revision,
        life: run.notebook.deaths + 1,
        eventIds: events.map((event) => event.id),
      }],
    },
    presentation: actions.length === 0 && (phase === "blocked" || (events.length === 0 && phase === "running")) ? null : presentation,
    presentationHistory: events.length > 0 || completedSegmentId || phase === "waiting" ? [...run.presentationHistory, presentation] : run.presentationHistory,
  };
}

function worldChanges(before: WorldState, after: WorldState): WorldEvent["changes"] {
  const changes: WorldEvent["changes"] = [];
  for (const id of new Set([...Object.keys(before.entities), ...Object.keys(after.entities)])) {
    const left = before.entities[id];
    const right = after.entities[id];
    const previous = { ...left?.properties, parent: left?.parent ?? null, region: left?.location.region ?? null, x: left?.location.x ?? null, y: left?.location.y ?? null };
    const current = { ...right?.properties, parent: right?.parent ?? null, region: right?.location.region ?? null, x: right?.location.x ?? null, y: right?.location.y ?? null };
    for (const property of new Set([...Object.keys(previous), ...Object.keys(current)])) {
      const oldValue = (previous as Record<string, string | number | boolean | null>)[property] ?? null;
      const newValue = (current as Record<string, string | number | boolean | null>)[property] ?? null;
      if (oldValue !== newValue) changes.push({ entity: id, property, before: oldValue, after: newValue });
    }
  }
  for (const id of new Set([...Object.keys(before.actors), ...Object.keys(after.actors)])) {
    const left = before.actors[id];
    const right = after.actors[id];
    const previous = { holding: left?.holding ?? null, riding: left?.riding ?? null, region: left?.location.region ?? null, x: left?.location.x ?? null, y: left?.location.y ?? null };
    const current = { holding: right?.holding ?? null, riding: right?.riding ?? null, region: right?.location.region ?? null, x: right?.location.x ?? null, y: right?.location.y ?? null };
    for (const property of Object.keys(previous) as (keyof typeof previous)[]) {
      if (previous[property] !== current[property]) changes.push({ entity: id, property, before: previous[property], after: current[property] });
    }
  }
  return changes;
}

/** A hash affects playback speed only, never whether a physical action executes. */
function replaySignature(world: WorldState, action: PhysicalAction, instructionId: string | null): string {
  const input = JSON.stringify({ stageId: world.stageId, segmentId: world.segmentId, tick: world.tick, entities: world.entities, actors: world.actors, visible: world.visible,
    facts: world.facts.filter((fact) => fact.attempt === world.attempt).map(({ entity, property, value, tick }) => ({ entity, property, value, tick })), action, instructionId });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `${world.segmentId}:${input.length}:${(hash >>> 0).toString(16)}`;
}
