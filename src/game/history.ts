import type {
  HistoryEntry,
  Instruction,
  RunHistory,
  RunState,
} from "./types";

export function copyInstruction(instruction: Instruction): Instruction {
  return {
    ...instruction,
    interpretation: {
      ...instruction.interpretation,
      appliesTo: [...instruction.interpretation.appliesTo],
    },
  };
}

/**
 * Returns persisted history, or the most honest history recoverable from an old save.
 * Old saves contain action events but no record of earlier notebook edits.
 */
export function getRunHistory(state: RunState): RunHistory {
  if (state.history) return state.history;

  let life = 1;
  const entries: HistoryEntry[] = state.events.map((event, index) => {
    const entry: HistoryEntry = {
      kind: "action",
      revision: index + 1,
      life,
      eventId: event.id,
    };
    if (event.outcome === "death" || event.outcome === "blocked") life += 1;
    return entry;
  });

  return {
    version: 1,
    complete: false,
    initialInstructions: state.instructions.map(copyInstruction),
    entries,
  };
}
