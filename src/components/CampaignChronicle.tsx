import { useMemo } from "react";
import type { CampaignStageDefinition } from "../campaign/level";
import type { StagePresentation, StageRun } from "../campaign/run";
import { stageSummary } from "../campaign/catalog";
import { playSound } from "../game/audio";
import type { Settings } from "../game/types";
import { CampaignCanvas } from "./CampaignCanvas";
import Chronicle, {
  groupChronicleEntries,
  type ChronicleEntry,
  type ChronicleViewModel,
} from "./Chronicle";
import Modal from "./Modal";

export function buildCampaignChronicleModel(
  run: StageRun,
  stage: CampaignStageDefinition,
): ChronicleViewModel<StagePresentation> {
  const eventById = new Map(run.events.map((event) => [event.id, event]));
  const presentationByEventId = new Map<string, StagePresentation>();
  for (const presentation of run.presentationHistory) {
    for (const event of presentation.events) {
      presentationByEventId.set(event.id, presentation);
    }
  }
  const instructionText = new Map(
    run.history.initialInstructions.map((instruction) => [instruction.id, instruction.text]),
  );
  for (const entry of run.history.entries) {
    if (entry.kind === "write") instructionText.set(entry.instruction.id, entry.instruction.text);
  }
  const segmentIndex = new Map(stage.segments.map((segment, index) => [segment.id, index]));
  const segmentTitle = new Map(stage.segments.map((segment) => [segment.id, segment.title]));

  const entries = run.history.entries.flatMap<ChronicleEntry<StagePresentation>>(
    (entry, index) => {
      if (entry.kind === "action") {
        const events = entry.eventIds.flatMap((id) => {
          const event = eventById.get(id);
          return event ? [event] : [];
        });
        const presentation = entry.eventIds
          .map((id) => presentationByEventId.get(id))
          .find((item) => item !== undefined);
        if (!events.length || !presentation) return [];
        const segmentId = presentation.before.segmentId;
        const order = segmentIndex.get(segmentId);
        const title = `${order === undefined ? "지난" : `${order + 1}번째`} 장면 · ${segmentTitle.get(segmentId) ?? "이름 없는 길"}`;
        const instructionId = events.find((event) => event.instructionId)?.instructionId;
        const quote = instructionId ? instructionText.get(instructionId) ?? "기록에 남은 지시"
          : events.some((event) => event.actor && event.verb === "move") ? "이전 기록의 자동 이동"
            : presentation.outcome === "blocked" ? "지시 없이 멈춤" : "장면의 변화";
        const description = events.map((event) => event.reason).join(" ");
        return [{
          id: presentation.id,
          kind: "action",
          life: entry.life,
          title,
          quote,
          description,
          outcome: presentation.outcome,
          repeated: presentation.repeated && presentation.outcome === "safe",
          replay: {
            id: presentation.id,
            title,
            quote,
            description,
            payload: presentation,
          },
        }];
      }

      let text: string;
      switch (entry.kind) {
        case "write":
          text = `새로 남긴 말: “${entry.instruction.text}”`;
          break;
        case "delete":
          text = `지운 말: “${entry.instructionText}” · ${entry.eraserCost ? `지우개 ${entry.eraserCost}개` : `+${entry.deathCost}데스`}`;
          break;
        case "reorder":
          text = `“${entry.instructionText}” 우선순위 변경 · 위에서 ${entry.from + 1}번째 → ${entry.to + 1}번째`;
          break;
        case "revive":
          text = "메모를 챙겨 던전 입구에서 다시 태어났어요.";
          break;
        case "abandon":
          text = "막힌 길에서 돌아오기로 했어요. · +1데스";
          break;
      }
      return [{
        id: `${entry.kind}-${entry.revision}-${index}`,
        kind: "change",
        life: entry.life,
        change: entry.kind,
        text,
      }];
    },
  );
  const finalLife = entries.reduce((latest, entry) => Math.max(latest, entry.life), 1);

  return {
    title: `제${stage.id}장 · ${stage.title}`,
    summary: `${run.notebook.deaths + run.notebook.penaltyDeaths}데스 · 사망·부활 ${run.notebook.deaths} + 삭제 비용 ${run.notebook.penaltyDeaths} · ${run.events.length}번의 행동`,
    initialNotes: {
      label: "처음 챙긴 메모",
      items: run.history.initialInstructions,
    },
    finalNotes: {
      label: `${run.phase === "cleared" ? "탈출할" : "지금"} 때의 메모장 · 위쪽부터 우선`,
      items: run.notebook.instructions,
    },
    lives: groupChronicleEntries(entries, run.phase === "cleared" ? finalLife : -1),
  };
}

export function CampaignChronicle({
  run,
  stage,
  settings,
  onClose,
}: {
  run: StageRun;
  stage: CampaignStageDefinition;
  settings: Settings;
  onClose: () => void;
}) {
  const model = useMemo(() => buildCampaignChronicleModel(run, stage), [run, stage]);
  const summary = stageSummary(stage.id);

  return (
    <Modal title="우리의 모험 돌아보기" onClose={onClose}>
      <div className="chronicle">
        <Chronicle
          model={model}
          settings={settings}
          musicStageId={summary.slug}
          renderReplay={({ replay, nonce, paused, reducedMotion, onPlaybackEnd }) => {
            const segmentId = replay.payload.before.segmentId;
            const displayIndex = stage.segments.findIndex((segment) => segment.id === segmentId);
            const segment = stage.segments[displayIndex];
            return (
              <CampaignCanvas
                key={nonce}
                world={replay.payload.after}
                scene={segment?.scene}
                title={segment?.title ?? model.title}
                displayNumber={displayIndex < 0 ? undefined : displayIndex + 1}
                reducedMotion={reducedMotion}
                paused={paused}
                presentation={replay.payload}
                onPlaybackEnd={onPlaybackEnd}
                onSound={(cue) => playSound(cue, settings.muted)}
              />
            );
          }}
        />
      </div>
    </Modal>
  );
}

export default CampaignChronicle;
