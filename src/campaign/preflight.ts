import { acknowledgePresentation, advanceStage, departStage, retryStage, type StageDynamics, type StageRun } from "./run";
import type { Notebook } from "./notebook";
import type { WorldEvent } from "./types";

export type ProgramPreflight =
  | { kind: "clarification"; instructionId: string | null; reason: string }
  | { kind: "admissible"; limited: boolean };

const MAX_PREFLIGHT_STEPS = 512;

function clarificationEvent(events: WorldEvent[]): WorldEvent | undefined {
  return events.find((event) => event.outcome === "clarification");
}

/**
 * Runs a bounded, throwaway execution from the current bookmark. Only an
 * explicit interpretation/feasibility rejection is returned to the editor;
 * physical failures and uncertain future progress remain executable.
 */
export function preflightProgram(run: StageRun, proposedNotebook: Notebook, dynamics: StageDynamics): ProgramPreflight {
  let dryRun = structuredClone(run);
  dryRun.notebook = structuredClone(proposedNotebook);
  if (dryRun.phase === "failed") dryRun = acknowledgePresentation(retryStage(dryRun));
  dryRun = departStage(dryRun);

  if (dryRun.phase === "cleared") return { kind: "admissible", limited: false };
  if (dryRun.phase !== "running" && dryRun.phase !== "waiting") return { kind: "admissible", limited: true };

  for (let step = 0; step < MAX_PREFLIGHT_STEPS; step++) {
    const eventOffset = dryRun.events.length;
    const next = advanceStage(dryRun, dynamics);
    const newEvents = next.events.slice(eventOffset);
    const actualClarification = clarificationEvent(newEvents);
    if (actualClarification) {
      return {
        kind: "clarification",
        instructionId: actualClarification.instructionId,
        reason: actualClarification.reason,
      };
    }

    if (newEvents.some((event) => event.outcome === "failure")) {
      return { kind: "admissible", limited: false };
    }
    if (next.phase === "cleared" || next.phase === "bookmark") {
      return { kind: "admissible", limited: false };
    }
    if (next.phase === "blocked" || next.phase === "failed") {
      return { kind: "admissible", limited: true };
    }
    // Validate one complete traversal, not endless repetitions of a standing rule.
    // The live scheduler still reselects it at the next decision boundary.
    if (next.execution.active === null) {
      return { kind: "admissible", limited: false };
    }

    dryRun = acknowledgePresentation(next);
  }

  return { kind: "admissible", limited: true };
}
