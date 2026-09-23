import type { ExecutionState } from './scheduler';
import type { PhysicalAction, WorldState } from './types';

export const STAGNATION_LIMIT = 3;
export interface StagnationState { key: string; count: number }

/** Ignore bookkeeping clocks, but keep physical state and newly learned information. */
function progressState(world: WorldState): string {
  const facts = new Map<string, unknown>();
  for (const fact of world.facts) {
    if (fact.attempt === world.attempt) facts.set(JSON.stringify([fact.entity, fact.property]), fact.value);
  }
  return JSON.stringify({
    stage: world.stageId, segment: world.segmentId, attempt: world.attempt,
    entities: world.entities, actors: world.actors, visible: world.visible,
    facts: [...facts].sort(([a], [b]) => a.localeCompare(b)),
  });
}

/** Count only consecutive identical, stationary decisions, not animation frames. */
export function nextStagnation(
  previous: StagnationState | undefined,
  before: WorldState,
  after: WorldState,
  actions: readonly PhysicalAction[],
  instructionId: string | null,
  execution: ExecutionState,
  clock?: string,
): StagnationState | undefined {
  const state = progressState(after);
  if (actions.length === 0 || progressState(before) !== state) return undefined;
  // Procedure cursors and device phases distinguish real progress from repeated instructions.
  const key = JSON.stringify({ state, actions, instructionId, execution, clock });
  return { key, count: previous?.key === key ? previous.count + 1 : 1 };
}
