import { resolveProgramBindings, type ProgramBindingResolution } from "./bindings";
import { createCursor, stepProgram, type ActionExecutor, type ProgramCursor, type ProgramStep } from "./program";
import type { InstructionProgram, WorldState } from "./types";

export interface ActiveProcedure { instructionId: string; cursor: ProgramCursor }
export interface ExecutionState {
  active: ActiveProcedure | null;
  suspended: ActiveProcedure[];
  /** Completion keyed by explicit encounter epoch, not mutable physical state. */
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
function key(state: ExecutionState, id: string): string { return `${state.epoch}:${id}`; }
export function isProgramApplicable(world: WorldState, program: InstructionProgram): boolean {
  const resolution = resolveProgramBindings(world, program);
  return resolution.kind === "resolved" && resolution.condition === true;
}
function clarification(world: WorldState, reason: string): ProgramStep {
  return { world, cursor: { ...createCursor(), status: "blocked", reason }, actions: [], outcome: "clarification", reason };
}
/** Call only at an atomic action boundary; presentation must not call this mid-animation. */
export function scheduleStep(world: WorldState, programs: InstructionProgram[], execution: ExecutionState, execute: ActionExecutor): ScheduledStep {
  let next = structuredClone(execution);
  const resolutions = new Map<string, ProgramBindingResolution>();
  const resolved = (program: InstructionProgram) => {
    const cached = resolutions.get(program.id);
    if (cached) return cached;
    const value = resolveProgramBindings(world, program);
    resolutions.set(program.id, value);
    return value;
  };
  // Literal programs bind when selected, then preserve their exact in-flight
  // cursor even if an earlier action consumes or hides a referenced object.
  const executable = (program: InstructionProgram): ProgramBindingResolution => program.bindings
    ? resolved(program)
    : { kind: "resolved", program, condition: true };
  for (const program of programs) {
    const resolution = resolved(program);
    const matches = resolution.kind === "resolved" && resolution.condition === true;
    if (next.matches[program.id] === false && matches) {
      next.completed = next.completed.filter((entry) => entry !== key(next, program.id));
    }
    next.matches[program.id] = matches;
  }
  let interrupted: string | null = null;
  let activeIndex = next.active ? programs.findIndex((program) => program.id === next.active!.instructionId) : -1;
  if (next.active && activeIndex < 0) return { instructionId: null, execution, step: null, interrupted: null, reason: "실행 중인 메모가 없어 이어갈 수 없어요." };
  if (next.active) {
    const activeResolution = executable(programs[activeIndex]);
    if (activeResolution.kind === "clarification" || activeResolution.kind === "dormant") {
      const reason = activeResolution.kind === "clarification" ? activeResolution.reason : "실행 중인 메모의 대상을 현재 장면에서 다시 찾지 못했어요.";
      return { instructionId: programs[activeIndex].id, execution: next, step: clarification(world, reason), interrupted: null, reason };
    }
    const guardIndex = programs.findIndex((program, index) => index < activeIndex && program.guard && !next.completed.includes(key(next, program.id)) && (() => {
      const candidate = resolved(program);
      return candidate.kind === "clarification" || (candidate.kind === "resolved" && candidate.condition === true);
    })());
    if (guardIndex >= 0) {
      const guard = resolved(programs[guardIndex]);
      if (guard.kind === "clarification") return { instructionId: programs[guardIndex].id, execution: next, step: clarification(world, guard.reason), interrupted: null, reason: guard.reason };
      interrupted = next.active.instructionId;
      next.suspended.push(next.active);
      next.active = { instructionId: programs[guardIndex].id, cursor: createCursor() };
      activeIndex = guardIndex;
    }
  } else {
    // Resume the exact interruption point before selecting a new lower-priority procedure.
    const suspended = next.suspended.pop();
    if (suspended) {
      next.active = suspended;
      return scheduleStep(world, programs, next, execute);
    }
    activeIndex = programs.findIndex((program) => !next.completed.includes(key(next, program.id)) && (() => {
      const candidate = resolved(program);
      return candidate.kind === "clarification" || (candidate.kind === "resolved" && candidate.condition === true);
    })());
    if (activeIndex < 0) return { instructionId: null, execution: next, step: null, interrupted: null, reason: "현재 상황에 적용되는 메모가 없어 안전한 곳에서 멈췄어요." };
    const selected = resolved(programs[activeIndex]);
    if (selected.kind === "clarification") return { instructionId: programs[activeIndex].id, execution: next, step: clarification(world, selected.reason), interrupted: null, reason: selected.reason };
    next.active = { instructionId: programs[activeIndex].id, cursor: createCursor() };
  }
  const instructionId = next.active.instructionId;
  const selected = executable(programs[activeIndex]);
  if (selected.kind !== "resolved") {
    const reason = selected.kind === "clarification" ? selected.reason : "메모의 대상을 현재 장면에서 찾지 못했어요.";
    return { instructionId, execution: next, step: clarification(world, reason), interrupted, reason };
  }
  const step = stepProgram(world, selected.program.body, next.active.cursor, execute);
  if (step.outcome === "done") {
    next.completed.push(key(next, next.active.instructionId));
    next.active = null;
  } else next.active = { ...next.active, cursor: step.cursor };
  return { instructionId, execution: next, step, interrupted, reason: step.reason };
}
