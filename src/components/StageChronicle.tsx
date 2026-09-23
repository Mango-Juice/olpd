import { useEffect, useMemo, useState } from "react";
import { listStageArchives, type StageArchive } from "../game/archive";
import { playSound } from "../game/audio";
import { ACTION_LABELS, OBSERVATIONS, ROOMS } from "../game/content";
import { getRunHistory } from "../game/history";
import type { ExecutionEvent, Settings } from "../game/types";
import Chronicle, {
  groupChronicleEntries,
  type ChronicleEntry,
  type ChronicleViewModel,
} from "./Chronicle";
import { DungeonCanvas } from "./DungeonCanvas";
import Modal from "./Modal";

export function buildStageChronicleModel(
  record: StageArchive,
): ChronicleViewModel<ExecutionEvent> {
  const state = record.save.state;
  const history = getRunHistory(state);
  const events = new Map(state.events.map((event) => [event.id, event]));
  const entries = history.entries.flatMap<ChronicleEntry<ExecutionEvent>>(
    (entry, index) => {
      if (entry.kind === "action") {
        const event = events.get(entry.eventId);
        if (!event) return [];
        const title = `${event.room + 1}번째 문 · ${OBSERVATIONS[event.observation].label}`;
        const quote = event.instructionText ?? "이전 기록의 자동 이동";
        return [{
          id: event.id,
          kind: "action",
          life: entry.life,
          title,
          quote,
          description: `${ACTION_LABELS[event.action]} → ${event.reason}`,
          outcome: event.outcome,
          repeated: !!event.repeated && event.outcome === "safe" && event.id !== state.lastEvent?.id,
          replay: {
            id: event.id,
            title,
            quote,
            description: event.reason,
            payload: { ...event, repeated: false },
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
  const escapedLife = entries.reduce((latest, entry) => Math.max(latest, entry.life), 1);

  return {
    title: record.title,
    summary: `${state.deaths + state.penaltyDeaths}데스 · 사망·부활 ${state.deaths} + 삭제 비용 ${state.penaltyDeaths} · ${state.events.length}번의 행동`,
    notice: history.complete
      ? undefined
      : "이전 버전의 모험이에요. 행동 기록은 남아 있지만, 당시 메모를 쓰고 지우거나 순서를 바꾼 이력은 남아 있지 않아요.",
    initialNotes: {
      label: history.complete ? "처음 챙긴 메모" : "기록에 남은 메모",
      items: history.initialInstructions,
    },
    finalNotes: {
      label: "탈출할 때의 메모장 · 위쪽부터 우선",
      items: state.instructions,
    },
    lives: groupChronicleEntries(entries, escapedLife),
  };
}

export default function StageChronicle({
  current,
  archives,
  settings,
  onClose,
}: {
  current: StageArchive | null;
  /** Supplied by the campaign repository; omit for the legacy standalone app. */
  archives?: StageArchive[];
  settings: Settings;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<StageArchive[]>([]);
  const [selected, setSelected] = useState<StageArchive | null>(current);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (archives) {
      setRecords(archives);
      setLoading(false);
      return;
    }
    let active = true;
    listStageArchives()
      .then((items) => {
        if (!active) return;
        setRecords(items);
        setSelected((previous) =>
          previous
            ? (items.find((item) => item.id === previous.id) ?? previous)
            : null,
        );
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "지난 모험을 불러오지 못했어요.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [archives]);

  const available = current && !records.some((record) => record.id === current.id)
    ? [current, ...records]
    : records;

  return (
    <Modal title="우리의 모험 돌아보기" onClose={onClose}>
      <div className="chronicle">
        {error ? <p className="error" role="alert">{error}</p> : null}
        {selected ? (
          <>
            <button type="button" className="secondary" onClick={() => setSelected(null)}>
              ← 지난 모험 목록
            </button>
            <StageChronicleDetail key={selected.id} record={selected} settings={settings} />
          </>
        ) : (
          <>
            <p>넘어지고 다시 일어서며, 우리가 함께 남긴 기록이에요.</p>
            {loading ? <p role="status">기록을 펼치고 있어요…</p> : null}
            {!loading && !available.length && !error ? <p>첫 여정을 마치면 여기에 모험 기록이 남아요.</p> : null}
            <ul className="chronicle-archives">
              {available.map((record) => (
                <li key={record.id}>
                  <button type="button" onClick={() => setSelected(record)}>
                    <strong>{record.title}</strong>
                    <span>
                      {new Date(record.completedAt).toLocaleString("ko-KR")} ·{" "}
                      {record.save.state.deaths + record.save.state.penaltyDeaths}데스
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

function StageChronicleDetail({ record, settings }: { record: StageArchive; settings: Settings }) {
  const model = useMemo(() => buildStageChronicleModel(record), [record]);
  const finalEventId = record.save.state.lastEvent?.id;

  return (
    <Chronicle
      model={model}
      settings={settings}
      musicStageId={record.stageId}
      renderReplay={({ replay, nonce, paused, reducedMotion, onPlaybackEnd }) => (
        <DungeonCanvas
          key={nonce}
          event={replay.payload}
          observation={OBSERVATIONS[replay.payload.observation]}
          phase={replay.payload.id === finalEventId ? "cleared" : "running"}
          paused={paused}
          reducedMotion={reducedMotion}
          roomName={ROOMS[replay.payload.room]?.name}
          onPlaybackEnd={onPlaybackEnd}
          onSound={(cue) => playSound(cue, settings.muted)}
        />
      )}
    />
  );
}
