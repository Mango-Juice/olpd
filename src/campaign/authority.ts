import { loadSave } from "../game/storage";
import type { SaveData } from "../game/types";
import type { CampaignStageDefinition } from "./level";
import type { RunCompletionAuthority } from "./progress";
import type { StageRun } from "./run";
import { parseStageRun } from "./run-validation";
import { stageSummary } from "./catalog";
import type { StageId } from "./types";

export type CampaignStoredRun = { kind: "legacy"; save: SaveData } | { kind: "world"; run: StageRun };
export function campaignAuthority(resolveStage: (id: StageId) => CampaignStageDefinition | null): RunCompletionAuthority<CampaignStoredRun> {
  return {
    parse(value) {
      if (!value || typeof value !== "object") return null;
      const raw = value as Record<string, unknown>;
      if (raw.kind === "legacy") {
        const parsed = loadSave({ getItem: () => JSON.stringify(raw.save), setItem: () => undefined });
        return parsed.ok && parsed.value ? { kind: "legacy", save: parsed.value } : null;
      }
      if (raw.kind !== "world") return null;
      const run = parseStageRun(raw.run);
      if (!run) return null;
      const stage = resolveStage(run.stageId);
      if (!stage || stage.segments.length !== stageSummary(run.stageId).segments || new Set(stage.segments.map((segment) => segment.id)).size !== stage.segments.length) return null;
      // Content wording may change without invalidating a saved physical state.
      const labels = new Map([...stage.segments, stage.practice].flatMap((segment) =>
        Object.values(segment.enter(null).entities).map((entity) => [entity.id, entity] as const)));
      for (const world of [run.world, run.checkpoint]) {
        for (const entity of Object.values(world.entities)) {
          const current = labels.get(entity.id);
          if (current) { entity.name = current.name; entity.description = current.description; }
        }
      }
      const ids = stage.segments.map((segment) => segment.id);
      if (!ids.includes(run.world.segmentId) || !ids.includes(run.checkpoint.segmentId) || run.clearedSegments.some((id) => !ids.includes(id)) || run.notebook.visitedBookmarks.some((id) => !ids.includes(id))) return null;
      if (run.phase === "cleared" && (run.clearedSegments.length !== stage.segments.length || run.world.segmentId !== ids[ids.length - 1] || !stage.segments[stage.segments.length - 1].complete(run.world))) return null;
      return { kind: "world", run };
    },
    serialize: (run) => structuredClone(run),
    describe: (run) => run.kind === "legacy" ? { stageId: 1, runId: run.save.state.id } : { stageId: run.run.stageId, runId: run.run.id },
    isCleared: (run) => run.kind === "legacy" ? !run.save.state.tutorial && run.save.state.phase === "cleared" : run.run.phase === "cleared",
  };
}
