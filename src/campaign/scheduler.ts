import { resolveProgramBindings, type ProgramBindingResolution } from "./bindings";
import { evaluateCondition } from "./conditions";
import { createCursor, stepProgram, type ActionExecutor, type ProgramCursor, type ProgramStep } from "./program";
import type { InstructionProgram, WorldState } from "./types";

export interface ActiveProcedure { instructionId: string; cursor: ProgramCursor }
export interface ExecutionState {
  active: ActiveProcedure | null;
  suspended: ActiveProcedure[];
  /** Legacy save fields. A notebook rule is never consumed by completion. */
  completed: string[];
  epoch: number;
  matches: Record<string, boolean>;
}
export interface ScheduledStep {
  instructionId: string | null;
  execution: ExecutionState;
  step: ProgramStep | null;
  interrupted: string | null;
  reason: string | null;
}
export function createExecution(): ExecutionState {
  return { active: null, suspended: [], completed: [], epoch: 0, matches: {} };
}
export function enterEncounter(state: ExecutionState): ExecutionState {
  return { ...state, epoch: state.epoch + 1, completed: [], active: null, suspended: [], matches: {} };
}
export function isProgramApplicable(world: WorldState, program: InstructionProgram): boolean {
  const resolution = resolveProgramBindings(world, program);
  return resolution.kind === "resolved" && resolution.condition === true
    && (resolution.program.body.kind !== "if"
      || Boolean(resolution.program.body.otherwise)
      || evaluateCondition(world, resolution.program.body.condition) === true);
}
function clarification(world: WorldState, reason: string): ProgramStep {
  return { world, cursor: { ...createCursor(), status: "blocked", reason }, actions: [], outcome: "clarification", reason };
}
/** Call only at an atomic action boundary; presentation must not call this mid-animation. */
export function scheduleStep(world: WorldState, programs: InstructionProgram[], execution: ExecutionState, execute: ActionExecutor): ScheduledStep {
  const next = structuredClone(execution);
  // Old saves can contain consumed-rule bookkeeping. It no longer affects selection.
  next.completed = [];
  next.matches = {};
  const resolutions = new Map<string, ProgramBindingResolution>();
  const resolved = (program: InstructionProgram) => {
    const cached = resolutions.get(program.id);
    if (cached) return cached;
    const value = resolveProgramBindings(world, program);
    resolutions.set(program.id, value);
    return value;
  };
  let selectedIndex = -1;
  let selected: ProgramBindingResolution | null = null;
  let selectedBranch: "then" | "otherwise" | null = null;
  for (const [index, program] of programs.entries()) {
    let candidate = resolved(program);
    // A literal action already in progress can finish even when movement has
    // hidden or consumed its originally named object. Conditions still rescan.
    const stored = next.active?.instructionId === program.id
      ? next.active
      : next.suspended.find((item) => item.instructionId === program.id);
    if (candidate.kind === "dormant" && candidate.reason === "literal" && !program.bindings && stored
      && (program.scope.stageId === undefined || program.scope.stageId === world.stageId)
      && (program.scope.region === undefined || program.scope.region === world.actors.hero?.location.region)) {
      candidate = { kind: "resolved", program, condition: program.condition ? evaluateCondition(world, program.condition) : true };
    }
    if (candidate.kind === "dormant") continue;
    if (candidate.kind === "resolved") {
      if (candidate.condition === false) continue;
      if (candidate.condition === true && candidate.program.body.kind === "if") {
        const condition = evaluateCondition(world, candidate.program.body.condition);
        if (condition === false && !candidate.program.body.otherwise) {
          if (stored?.cursor.branch === "then") stored.cursor = createCursor();
          continue;
        }
        if (condition !== "unknown") selectedBranch = condition ? "then" : "otherwise";
        else selectedBranch = null;
      }
    }
    selectedIndex = index;
    selected = candidate;
    break;
  }
  if (selectedIndex < 0 || !selected) {
    if (next.active) {
      next.suspended = next.suspended.filter((item) => item.instructionId !== next.active!.instructionId);
      next.suspended.push(next.active);
      next.active = null;
    }
    return { instructionId: null, execution: next, step: null, interrupted: null, reason: "현재 상황에 적용되는 메모가 없어 안전한 곳에서 멈췄어요." };
  }

  const instructionId = programs[selectedIndex].id;
  if (selected.kind === "clarification" || selected.condition === "unknown" || (selected.program.body.kind === "if" && selectedBranch === null)) {
    const reason = selected.kind === "clarification" ? selected.reason : "조건을 먼저 관찰해야 해요.";
    return { instructionId, execution: next, step: clarification(world, reason), interrupted: null, reason };
  }

  const interrupted = next.active && next.active.instructionId !== instructionId ? next.active.instructionId : null;
  if (interrupted && next.active) {
    next.suspended = next.suspended.filter((item) => item.instructionId !== interrupted);
    next.suspended.push(next.active);
    next.active = null;
  }
  if (!next.active) {
    const suspendedIndex = next.suspended.findIndex((item) => item.instructionId === instructionId);
    next.active = suspendedIndex < 0
      ? { instructionId, cursor: createCursor() }
      : next.suspended.splice(suspendedIndex, 1)[0];
  }
  if (selectedBranch && next.active.cursor.branch && next.active.cursor.branch !== selectedBranch) {
    next.active.cursor = createCursor();
  }
  const step = stepProgram(world, selected.program.body, next.active.cursor, execute);
  if (step.outcome === "done") next.active = null;
  else next.active = { ...next.active, cursor: step.cursor };
  return { instructionId, execution: next, step, interrupted, reason: step.reason };
}
