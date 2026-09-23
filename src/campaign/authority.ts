import { isOnboardingProgress, progressBelongsToRun, type OnboardingProgress } from "../game/onboarding";
import { loadSave } from "../game/storage";
import type { SaveData } from "../game/types";
import { allStageSegments, type CampaignStageDefinition } from "./level";
import type { RunCompletionAuthority } from "./progress";
import type { StageRun } from "./run";
import { parseStageRun } from "./run-validation";
import type { StageId } from "./types";

export type CampaignStoredRun =
  | { kind: "legacy"; save: SaveData; onboarding?: OnboardingProgress }
  | { kind: "world"; run: StageRun };

export function campaignAuthority(
  resolveStage: (id: StageId) => CampaignStageDefinition | null,
): RunCompletionAuthority<CampaignStoredRun> {
  return {
    parse(value) {
      if (!value || typeof value !== "object") return null;
      const raw = value as Record<string, unknown>;
      if (raw.kind === "legacy") {
        const parsed = loadSave({ getItem: () => JSON.stringify(raw.save), setItem: () => undefined });
        if (!parsed.ok || !parsed.value) return null;
        if (raw.onboarding !== undefined &&
          (!isOnboardingProgress(raw.onboarding) || !progressBelongsToRun(raw.onboarding, parsed.value.state.id))) return null;
        return { kind: "legacy", save: parsed.value,
          ...(raw.onboarding !== undefined ? { onboarding: structuredClone(raw.onboarding) as OnboardingProgress } : {}) };
      }
      if (raw.kind !== "world") return null;
      const run = parseStageRun(raw.run);
      if (!run) return null;
      const stage = resolveStage(run.stageId);
      if (!stage || stage.contentRevision !== run.contentRevision) return null;
      const allSegments = allStageSegments(stage);
      if (new Set(allSegments.map((segment) => segment.id)).size !== allSegments.length) return null;
      const ids = stage.segments.map((segment) => segment.id);
      const currentIndex = ids.indexOf(run.world.segmentId);
      if (currentIndex < 0 || run.checkpoint.segmentId !== ids[0]) return null;
      const expectedCompleted = run.phase === "cleared" ? ids : ids.slice(0, currentIndex);
      if (run.clearedSegments.length !== expectedCompleted.length ||
        run.clearedSegments.some((id, index) => id !== expectedCompleted[index])) return null;

      // Labels may change without invalidating a physical save.
      const labels = new Map([...allSegments, stage.practice].flatMap((segment) =>
        Object.values(segment.enter(null).entities).map((entity) => [entity.id, entity] as const)));
      for (const world of [run.world, run.checkpoint]) {
        for (const entity of Object.values(world.entities)) {
          const current = labels.get(entity.id);
          if (current) { entity.name = current.name; entity.description = current.description; }
        }
      }
      if (run.phase === "cleared" &&
        (run.world.segmentId !== ids.at(-1) || !stage.segments.at(-1)?.complete(run.world))) return null;
      return { kind: "world", run };
    },
    serialize: (run) => structuredClone(run),
    describe: (run) => run.kind === "legacy"
      ? { stageId: 1, runId: run.save.state.id }
      : { stageId: run.run.stageId, runId: run.run.id },
    isCleared: (run) => run.kind === "legacy"
      ? !run.save.state.tutorial && run.save.state.phase === "cleared"
      : run.run.phase === "cleared",
  };
}
