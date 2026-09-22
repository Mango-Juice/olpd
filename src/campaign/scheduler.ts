import { evaluateCondition } from "./conditions";
import { createCursor, stepProgram, type ActionExecutor, type ProgramCursor, type ProgramStep } from "./program";
import type { InstructionProgram, ProgramNode, WorldState } from "./types";

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
function referencesPresent(world: WorldState, node: ProgramNode): boolean {
  if (node.kind === "action") return [node.target, node.destination, node.instrument].every((id) => id === undefined || Object.hasOwn(world.entities, id));
  if (node.kind === "wait") return true;
  if (node.kind === "until") return referencesPresent(world, node.body);
  if (node.kind === "if") return referencesPresent(world, node.then) && (!node.otherwise || referencesPresent(world, node.otherwise));
  return node.children.every((child) => referencesPresent(world, child));
}
export function isProgramApplicable(world: WorldState, program: InstructionProgram): boolean {
  // A literal target belongs to that object, not another similarly named object in a later room.
  if (!referencesPresent(world, program.body)) return false;
  if (program.scope.stageId !== undefined && program.scope.stageId !== world.stageId) return false;
  if (program.scope.region !== undefined && program.scope.region !== world.actors.hero?.location.region) return false;
  return !program.condition || evaluateCondition(world, program.condition) === true;
}
/** Call only at an atomic action boundary; presentation must not call this mid-animation. */
export function scheduleStep(world: WorldState, programs: InstructionProgram[], execution: ExecutionState, execute: ActionExecutor): ScheduledStep {
  let next = structuredClone(execution);
  for (const program of programs) {
    const matches = isProgramApplicable(world, program);
    if (next.matches[program.id] === false && matches) {
      next.completed = next.completed.filter((entry) => entry !== key(next, program.id));
    }
    next.matches[program.id] = matches;
  }
  let interrupted: string | null = null;
  let activeIndex = next.active ? programs.findIndex((program) => program.id === next.active!.instructionId) : -1;
  if (next.active && activeIndex < 0) return { instructionId: null, execution, step: null, interrupted: null, reason: "실행 중인 메모가 없어 이어갈 수 없어요." };
  if (next.active) {
    const guardIndex = programs.findIndex((program, index) => index < activeIndex && program.guard && !next.completed.includes(key(next, program.id)) && isProgramApplicable(world, program));
    if (guardIndex >= 0) {
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
    activeIndex = programs.findIndex((program) => !next.completed.includes(key(next, program.id)) && isProgramApplicable(world, program));
    if (activeIndex < 0) return { instructionId: null, execution: next, step: null, interrupted: null, reason: "현재 상황에 적용되는 메모가 없어 안전한 곳에서 멈췄어요." };
    next.active = { instructionId: programs[activeIndex].id, cursor: createCursor() };
  }
  const instructionId = next.active.instructionId;
  const step = stepProgram(world, programs[activeIndex].body, next.active.cursor, execute);
  if (step.outcome === "done") {
    next.completed.push(key(next, next.active.instructionId));
    next.active = null;
  } else next.active = { ...next.active, cursor: step.cursor };
  return { instructionId, execution: next, step, interrupted, reason: step.reason };
}
