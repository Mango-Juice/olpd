import { evaluateCondition } from "./conditions";
import { clarifyNotebook, createNotebook, departNotebook, rewindNotebook, visitBookmark, type Notebook } from "./notebook";
import { createExecution, enterEncounter, scheduleStep, type ExecutionState } from "./scheduler";
import type { ActionExecutor, ActionResult } from "./program";
import type { PhysicalAction, StageId, WorldEvent, WorldState } from "./types";

export interface StageRun {
  version: 2;
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
}
export function createStageRun(id: string, initial: WorldState): StageRun {
  if (initial.stageId === 1) throw new Error("1장은 기존 실행기를 사용해요.");
  return { version: 2, id, stageId: initial.stageId, revision: 0, statusReason: null, waitingStates: [], phase: "bookmark", world: structuredClone(initial), checkpoint: structuredClone(initial), notebook: createNotebook(initial.segmentId), execution: createExecution(), events: [], clearedSegments: [], seal: 0 };
}
export function departStage(run: StageRun): StageRun {
  if (run.phase !== "bookmark") return run;
  return { ...run, phase: "running", statusReason: null, waitingStates: [], revision: run.revision + 1, notebook: departNotebook(run.notebook) };
}
/** The notebook and discovery ledger remain outside every world rewind snapshot. */
export function rewindStage(run: StageRun): StageRun {
  if (run.phase === "cleared" || run.notebook.clarificationId) return run;
  const world = structuredClone(run.checkpoint);
  world.attempt = run.world.attempt + 1;
  world.facts = [...run.world.facts];
  return { ...run, revision: run.revision + 1, phase: "bookmark", world, waitingStates: [], notebook: rewindNotebook(run.notebook), execution: createExecution() };
}
export interface EnvironmentStep {
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
  /** Boss checkpoints only; ordinary discovery bookmarks are never respawn points. */
  sealAfter: (segmentId: string) => number | null;
}
export function advanceStage(run: StageRun, dynamics: StageDynamics): StageRun {
  if (run.phase !== "running" && run.phase !== "waiting") return run;
  const traces: { before: WorldState; result: ActionResult }[] = [];
  const scheduled = scheduleStep(run.world, run.notebook.instructions, run.execution, (world, action) => {
    const before = structuredClone(world);
    const result = dynamics.execute(world, action);
    traces.push({ before, result });
    return result;
  });
  let world = scheduled.step?.world ?? run.world;
  const events: WorldEvent[] = [];
  const instructionId = scheduled.instructionId;
  const actions = scheduled.step?.actions ?? [];
  for (const [index, action] of actions.entries()) {
    const trace = traces[index];
    const signature = replaySignature(trace.before, action, instructionId);
    const repeated = run.events.some((event) => event.signature === signature && event.outcome === "safe");
    events.push({ segmentId: trace.before.segmentId, signature, repeated, id: `${run.id}:${run.revision + 1}:${index}`, tick: world.tick, attempt: world.attempt, instructionId, actor: action.actor, target: action.target, outcome: trace.result.outcome === "done" || trace.result.outcome === "progress" ? action.verb === "observe" || action.verb === "remember" ? "observed" : "safe" : trace.result.outcome, reason: trace.result.reason, changes: worldChanges(trace.before, trace.result.world) });
  }
  if (scheduled.interrupted) events.unshift({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:interrupt`, tick: world.tick, attempt: world.attempt, instructionId: scheduled.interrupted, actor: null, target: null, outcome: "interrupted", reason: "더 높은 경계 지침을 먼저 실행하고 중단 지점을 보관했어요.", changes: [] });
  if (scheduled.step?.outcome === "clarification" && instructionId) {
    if (!events.some((event) => event.outcome === "clarification")) events.push({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:clarification`, tick: world.tick, attempt: world.attempt, instructionId, actor: null, target: null, outcome: "clarification", reason: scheduled.reason ?? "지침의 뜻을 확인해야 해요.", changes: [] });
    const checkpoint = structuredClone(run.checkpoint);
    checkpoint.attempt = run.world.attempt + 1;
    checkpoint.facts = [...run.world.facts];
    return { ...run, revision: run.revision + 1, phase: "bookmark", world: checkpoint, waitingStates: [],
      notebook: clarifyNotebook(run.notebook, instructionId), execution: createExecution(), events: [...run.events, ...events],
      statusReason: `${scheduled.reason ?? "지침의 뜻을 확인해야 해요."} 종을 쓰지 않고 돌아왔어요. 해당 메모를 무료로 고칠 수 있어요.` };
  }
  const waitingForRule = scheduled.step === null && run.notebook.instructions.some((program) =>
    program.condition && (program.scope.stageId === undefined || program.scope.stageId === world.stageId) &&
    (program.scope.region === undefined || program.scope.region === world.actors.hero.location.region) &&
    evaluateCondition(world, program.condition) === false,
  );
  let phase: StageRun["phase"] = scheduled.step?.outcome === "failure" ? "failed" : (scheduled.step === null && !waitingForRule) || scheduled.step?.outcome === "blocked" ? "blocked" : "running";
  let statusReason = waitingForRule ? "메모의 조건이 바뀌기를 안전한 곳에서 기다리고 있어요." : scheduled.reason;
  if (phase === "running" && (actions.length > 0 || scheduled.step?.outcome === "waiting" || waitingForRule)) {
    const beforeEnvironment = world;
    const environment = dynamics.advance(world);
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
    else if (scheduled.step?.outcome === "waiting" || waitingForRule) phase = environment.canChange || changes.length > 0 ? "waiting" : "blocked";
  }
  let waitingStates: string[] = [];
  if (phase === "waiting" && actions.length === 0) {
    const signature = JSON.stringify({
      segment: world.segmentId,
      entities: Object.entries(world.entities).sort(([a], [b]) => a.localeCompare(b)).map(([id, entity]) => [id, entity.location, entity.parent, entity.properties]),
      actors: world.actors, visible: world.visible,
    });
    if (run.waitingStates.includes(signature)) {
      phase = "blocked";
      statusReason = "장치가 같은 상태로 되돌아왔지만 대기 조건은 이루어지지 않았어요. 현재 조건과 연결을 확인해 주세요.";
    } else waitingStates = [...run.waitingStates, signature];
  }
  let next: StageRun = { ...run, waitingStates, revision: run.revision + 1, world, phase, statusReason, execution: scheduled.execution, events: [...run.events, ...events] };
  if (phase === "failed") return rewindStage(next);
  if (dynamics.segmentComplete(world)) {
    const segmentId = world.segmentId;
    const following = dynamics.nextSegment(world);
    next.clearedSegments = [...new Set([...run.clearedSegments, segmentId])];
    if (!following) return { ...next, phase: "cleared" };
    const firstVisit = !next.notebook.visitedBookmarks.includes(following.segmentId);
    next = { ...next, world: following, phase: firstVisit ? "bookmark" : "running", execution: enterEncounter(next.execution), notebook: visitBookmark(next.notebook, following.segmentId) };
    const seal = dynamics.sealAfter(segmentId);
    if (seal !== null) {
      if (run.stageId !== 10) throw new Error("일반 장의 책갈피를 부활 지점으로 바꿀 수 없어요.");
      next.seal = seal;
      next.checkpoint = structuredClone(following);
    }
  }
  return next;
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
