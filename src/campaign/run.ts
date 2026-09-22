import { evaluateCondition } from "./conditions";
import { clarifyNotebook, createNotebook, departNotebook, rewindNotebook, visitBookmark, type Notebook } from "./notebook";
import { createExecution, enterEncounter, scheduleStep, type ExecutionState } from "./scheduler";
import type { ActionExecutor, ActionResult } from "./program";
import type { PhysicalAction, StageId, WorldEvent, WorldState } from "./types";
import type { CampaignStageDefinition } from "./level";

export interface OnboardingLearning {
  /** Ordered prefix of the stage's required onboarding IDs. */
  completedSegmentIds: string[];
  /** Original confirmed input, separate from the active notebook and core chronicle. */
  attemptedSentences: { segmentId: string; text: string }[];
}

export interface StageRun {
  version: 2;
  /** Authored content contract. Absent only on runs saved before revisioned stages. */
  contentRevision?: "quiet-v1";
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
  /** Confirmed quiet-scene input, kept after each fresh scratch notebook replaces the last. */
  sceneNotes?: { segmentId: string; text: string }[];
  seal: number;
  /** Absent only on compatible version-2 runs saved before onboarding existed. */
  learning?: OnboardingLearning;
}
export function createStageRun(id: string, initial: WorldState, contentRevision?: StageRun["contentRevision"]): StageRun {
  if (initial.stageId === 1) throw new Error("1장은 기존 실행기를 사용해요.");
  return { version: 2, ...(contentRevision ? { contentRevision } : {}), id, stageId: initial.stageId, revision: 0, statusReason: null, waitingStates: [], phase: "bookmark", world: structuredClone(initial), checkpoint: structuredClone(initial), notebook: createNotebook(initial.segmentId), execution: createExecution(), events: [], clearedSegments: [], seal: 0 };
}
export function createPracticeRun(id: string, initial: WorldState): StageRun {
  const run = createStageRun(id, initial);
  return { ...run, notebook: createNotebook(initial.segmentId, true) };
}
/** Starts a new campaign with the notebook contract owned by its content revision. */
export function createCampaignRun(id: string, stage: CampaignStageDefinition): StageRun {
  const first = stage.onboarding?.[0] ?? stage.segments[0];
  if (!first) throw new Error("시작할 구간이 없어요.");
  const initial = first.enter(null);
  const run = createStageRun(id, initial, stage.contentRevision);
  if (stage.contentRevision === "quiet-v1") {
    return { ...run, notebook: createNotebook(first.id, true), sceneNotes: [] };
  }
  return { ...run, notebook: createNotebook(first.id, !!stage.onboarding?.length), learning: { completedSegmentIds: [], attemptedSentences: [] } };
}
export function departStage(run: StageRun): StageRun {
  if (run.phase !== "bookmark") return run;
  const learning = run.learning && run.notebook.scratch && run.notebook.instructions[0]
    ? { ...run.learning, attemptedSentences: [...run.learning.attemptedSentences, { segmentId: run.world.segmentId, text: run.notebook.instructions[0].text }] }
    : run.learning;
  const sentence = run.contentRevision === "quiet-v1" && run.notebook.scratch ? run.notebook.instructions[0]?.text : undefined;
  const sceneNotes = sentence ? [...(run.sceneNotes ?? []), { segmentId: run.world.segmentId, text: sentence }] : run.sceneNotes;
  return { ...run, phase: "running", statusReason: null, waitingStates: [], revision: run.revision + 1, notebook: departNotebook(run.notebook), ...(learning ? { learning } : {}), ...(sceneNotes ? { sceneNotes } : {}) };
}
/** The notebook and discovery ledger remain outside every world rewind snapshot. */
export function rewindStage(run: StageRun): StageRun {
  if (run.phase === "cleared" || run.notebook.clarificationId) return run;
  const world = structuredClone(run.checkpoint);
  world.attempt = run.world.attempt + 1;
  world.facts = run.notebook.scratch ? [...run.checkpoint.facts] : [...run.world.facts];
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
  /** Optional authored movement along one already-open, unambiguous core path. */
  idleAction?: (world: WorldState) => PhysicalAction | null;
  /** Runtime classification keeps onboarding records outside core bookmarks and clears. */
  isOnboardingSegment?: (segmentId: string) => boolean;
}
function validIdleMove(world: WorldState, action: PhysicalAction): boolean {
  return action.kind === "action" && action.actor === "hero" && action.verb === "move"
    && action.destination === undefined && action.instrument === undefined && action.amount === undefined && action.references === undefined
    && Object.keys(action).every((key) => key === "kind" || key === "actor" || key === "verb" || key === "target")
    && Object.hasOwn(world.entities, action.target) && world.visible.includes(action.target);
}
function stopUnsafeIdle(run: StageRun, execution: ExecutionState, reason: string, action?: PhysicalAction): StageRun {
  const event: WorldEvent = {
    segmentId: run.world.segmentId,
    id: `${run.id}:${run.revision + 1}:idle-stop`,
    tick: run.world.tick,
    attempt: run.world.attempt,
    instructionId: null,
    actor: action?.actor === "hero" ? "hero" : null,
    target: action?.target ?? null,
    outcome: "blocked",
    reason,
    changes: [],
  };
  return { ...run, revision: run.revision + 1, phase: "blocked", statusReason: reason, waitingStates: [], execution, events: [...run.events, event] };
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
  let waitingForRule = false;
  let unresolvedConditionalRule = false;
  if (scheduled.step === null) {
    for (const program of run.notebook.instructions) {
      if (!program.condition || (program.scope.stageId !== undefined && program.scope.stageId !== run.world.stageId)
        || (program.scope.region !== undefined && program.scope.region !== run.world.actors.hero.location.region)) continue;
      const value = evaluateCondition(run.world, program.condition);
      // A false guard is dormant until a later atomic boundary; it is not a wait instruction.
      if (value === false && !program.guard) waitingForRule = true;
      if (value === "unknown") unresolvedConditionalRule = true;
    }
  }
  let world = scheduled.step?.world ?? run.world;
  const events: WorldEvent[] = [];
  const instructionId = scheduled.instructionId;
  let actions = scheduled.step?.actions ?? [];
  let stepOutcome = scheduled.step?.outcome;
  let stepReason = scheduled.reason;
  let hasStep = scheduled.step !== null;
  let idleAction: PhysicalAction | null = null;
  const mayAdvanceByDefault = scheduled.step === null && !waitingForRule && !unresolvedConditionalRule && scheduled.execution.active === null
    && scheduled.execution.suspended.length === 0 && run.notebook.scratch !== true
    && dynamics.isOnboardingSegment?.(run.world.segmentId) !== true;
  if (mayAdvanceByDefault && dynamics.idleAction) {
    let candidate: PhysicalAction | null;
    try {
      candidate = dynamics.idleAction(structuredClone(run.world));
    } catch {
      return stopUnsafeIdle(run, scheduled.execution, "기본 전진 경로를 확인하지 못해 원래 자리에서 멈췄어요.");
    }
    if (candidate && !validIdleMove(run.world, candidate)) {
      return stopUnsafeIdle(run, scheduled.execution, "기본 전진은 용사의 눈앞에 보이는 열린 길 이동만 사용할 수 있어요. 원래 자리에서 멈췄어요.");
    }
    if (candidate) {
      const before = structuredClone(run.world);
      const result = dynamics.execute(structuredClone(run.world), candidate);
      if (result.outcome !== "done" && result.outcome !== "progress") {
        return stopUnsafeIdle(run, scheduled.execution, `기본 전진 경로가 더 이상 안전하지 않아 원래 자리에서 멈췄어요. ${result.reason}`, candidate);
      }
      traces.push({ before, result });
      idleAction = candidate;
      world = result.world;
      actions = [candidate];
      stepOutcome = result.outcome;
      stepReason = result.reason;
      hasStep = true;
    }
  }
  for (const [index, action] of actions.entries()) {
    const trace = traces[index];
    const signature = replaySignature(trace.before, action, instructionId);
    const repeated = run.events.some((event) => event.signature === signature && event.outcome === "safe");
    events.push({ verb: action.verb, segmentId: trace.before.segmentId, signature, repeated, id: `${run.id}:${run.revision + 1}:${index}`, tick: world.tick, attempt: world.attempt, instructionId, actor: action.actor, target: action.target, outcome: trace.result.outcome === "done" || trace.result.outcome === "progress" ? action.verb === "observe" || action.verb === "remember" ? "observed" : "safe" : trace.result.outcome, reason: trace.result.reason, changes: worldChanges(trace.before, trace.result.world) });
  }
  if (scheduled.interrupted) events.unshift({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:interrupt`, tick: world.tick, attempt: world.attempt, instructionId: scheduled.interrupted, actor: null, target: null, outcome: "interrupted", reason: "더 높은 경계 지침을 먼저 실행하고 중단 지점을 보관했어요.", changes: [] });
  if (scheduled.step?.outcome === "clarification" && instructionId) {
    if (!events.some((event) => event.outcome === "clarification")) events.push({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:clarification`, tick: world.tick, attempt: world.attempt, instructionId, actor: null, target: null, outcome: "clarification", reason: scheduled.reason ?? "지침의 뜻을 확인해야 해요.", changes: [] });
    const checkpoint = structuredClone(run.checkpoint);
    checkpoint.attempt = run.world.attempt + 1;
    checkpoint.facts = [...run.world.facts];
    return { ...run, revision: run.revision + 1, phase: "bookmark", world: checkpoint, waitingStates: [],
      notebook: clarifyNotebook(run.notebook, instructionId), execution: createExecution(), events: [...run.events, ...events],
      statusReason: run.contentRevision === "quiet-v1"
        ? scheduled.reason ?? "문장을 조금만 바꿔 주세요."
        : `${scheduled.reason ?? "지침의 뜻을 확인해야 해요."} 종을 쓰지 않고 돌아왔어요. 해당 메모를 무료로 고칠 수 있어요.` };
  }
  // A commanded ride keeps moving after the boarding action has finished.
  // This advances the environment only; it never invents a landing/action.
  const autonomousRide = run.contentRevision === "quiet-v1" && !hasStep && !waitingForRule
    && Object.values(world.actors).some((actor) => actor.riding !== null);
  let phase: StageRun["phase"] = stepOutcome === "failure" ? "failed" : (!hasStep && !waitingForRule && !autonomousRide) || stepOutcome === "blocked" ? "blocked" : "running";
  let statusReason = waitingForRule ? "메모의 조건이 바뀌기를 안전한 곳에서 기다리고 있어요." : stepReason;
  if (phase === "running" && (actions.length > 0 || stepOutcome === "waiting" || waitingForRule || autonomousRide)) {
    const beforeEnvironment = world;
    const environment = dynamics.advance(world);
    world = environment.world;
    events.push(...environment.events.map((event) => ({ ...event, segmentId: event.segmentId ?? world.segmentId })));
    const changes = worldChanges(beforeEnvironment, world);
    if (changes.length > 0) events.push({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:reaction`, tick: world.tick, attempt: world.attempt, instructionId, actor: null, target: null, outcome: "observed", reason: environment.reason ?? "물체와 장치의 상태가 바뀌었어요.", changes });
    if (environment.failure) {
      if (idleAction) return stopUnsafeIdle(run, scheduled.execution, `기본 전진 뒤 세계가 안전하지 않아 원래 자리에서 멈췄어요. ${environment.failure}`, idleAction);
      phase = "failed";
      statusReason = environment.failure;
      events.push({ segmentId: world.segmentId, id: `${run.id}:${run.revision + 1}:environment`, tick: world.tick, attempt: world.attempt, instructionId, actor: null, target: null, outcome: "failure", reason: environment.failure, changes: [] });
    }
    // A final transition (for example cooling finishes) must be observed once
    // before deciding that a now-stable mechanism cannot satisfy the wait.
    else if (stepOutcome === "waiting" || waitingForRule || autonomousRide) phase = environment.canChange || changes.length > 0 ? "waiting" : "blocked";
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
    if (dynamics.isOnboardingSegment?.(segmentId)) {
      if (!next.learning) throw new Error("도입 진행 기록이 없어요.");
      next.learning = { ...next.learning, completedSegmentIds: next.learning.completedSegmentIds.includes(segmentId)
        ? next.learning.completedSegmentIds : [...next.learning.completedSegmentIds, segmentId] };
      if (!following) return { ...next, phase: "cleared" };
      const remainsOnboarding = dynamics.isOnboardingSegment(following.segmentId);
      return {
        ...next,
        world: following,
        checkpoint: structuredClone(following),
        phase: "bookmark",
        statusReason: null,
        waitingStates: [],
        notebook: createNotebook(following.segmentId, remainsOnboarding),
        execution: createExecution(),
        // Onboarding actions live in the learning record, not the core adventure chronicle.
        events: [],
      };
    }
    next.clearedSegments = [...new Set([...run.clearedSegments, segmentId])];
    if (!following) return { ...next, phase: "cleared" };
    if (run.contentRevision === "quiet-v1") {
      const seal = dynamics.sealAfter(segmentId);
      return {
        ...next,
        world: following,
        checkpoint: structuredClone(following),
        phase: "bookmark",
        statusReason: null,
        waitingStates: [],
        notebook: createNotebook(following.segmentId, true),
        execution: createExecution(),
        seal: seal ?? next.seal,
      };
    }
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
