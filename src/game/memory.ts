/** Shared notebook economy. Instructions are persisted low-to-high priority. */
export const MEMORY_INITIAL_ERASERS = 2;
export const MEMORY_DELETE_PENALTY = 3;

export interface MemoryPolicyState<Item> {
  instructions: Item[];
  canWrite: boolean;
  erasers: number;
  penaltyDeaths: number;
}

export interface MemoryDeleteResult<Item, State extends MemoryPolicyState<Item>> {
  state: State;
  deleted: Item | null;
  eraserCost: 0 | 1;
  deathCost: 0 | typeof MEMORY_DELETE_PENALTY;
}

export function appendMemory<Item, State extends MemoryPolicyState<Item>>(
  state: State,
  item: Item,
): State {
  if (!state.canWrite) throw new Error("새 한 줄 기회가 없어요.");
  return { ...state, instructions: [...state.instructions, item], canWrite: false };
}

export function grantMemoryWrite<Item, State extends MemoryPolicyState<Item>>(
  state: State,
): State {
  return { ...state, canWrite: true };
}

export function consumeMemoryWrite<Item, State extends MemoryPolicyState<Item>>(
  state: State,
): State {
  return { ...state, canWrite: false };
}

export function deleteMemory<Item, State extends MemoryPolicyState<Item>>(
  state: State,
  id: string,
  identify: (item: Item) => string,
): MemoryDeleteResult<Item, State> {
  const index = state.instructions.findIndex((item) => identify(item) === id);
  if (index < 0) return { state, deleted: null, eraserCost: 0, deathCost: 0 };
  const deleted = state.instructions[index];
  const instructions = state.instructions.filter((_, position) => position !== index);
  if (state.erasers > 0) {
    return {
      state: { ...state, instructions, erasers: state.erasers - 1 },
      deleted,
      eraserCost: 1,
      deathCost: 0,
    };
  }
  return {
    state: {
      ...state,
      instructions,
      penaltyDeaths: state.penaltyDeaths + MEMORY_DELETE_PENALTY,
    },
    deleted,
    eraserCost: 0,
    deathCost: MEMORY_DELETE_PENALTY,
  };
}

/** "up" means one slot toward the visible top (higher priority). */
export function moveMemory<Item, State extends MemoryPolicyState<Item>>(
  state: State,
  id: string,
  direction: "up" | "down",
  identify: (item: Item) => string,
): State {
  const index = state.instructions.findIndex((item) => identify(item) === id);
  if (index < 0) return state;
  const target = direction === "up" ? index + 1 : index - 1;
  if (target < 0 || target >= state.instructions.length) return state;
  const instructions = [...state.instructions];
  [instructions[index], instructions[target]] = [instructions[target], instructions[index]];
  return { ...state, instructions };
}

/** Places an item around another item in the high-to-low order shown to players. */
export function placeMemory<Item, State extends MemoryPolicyState<Item>>(
  state: State,
  id: string,
  targetId: string,
  position: "before" | "after",
  identify: (item: Item) => string,
): State {
  if (id === targetId) return state;
  const item = state.instructions.find((candidate) => identify(candidate) === id);
  if (!item) return state;
  const instructions = state.instructions.filter((candidate) => identify(candidate) !== id);
  const target = instructions.findIndex((candidate) => identify(candidate) === targetId);
  if (target < 0) return state;
  // Stored order is low-to-high, hence visible "before" is after the target in storage.
  instructions.splice(position === "before" ? target + 1 : target, 0, item);
  if (instructions.every((candidate, index) => identify(candidate) === identify(state.instructions[index]))) return state;
  return { ...state, instructions };
}
