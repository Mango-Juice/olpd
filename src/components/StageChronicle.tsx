import { useEffect, useMemo, useRef, useState } from "react";
import { listStageArchives, type StageArchive } from "../game/archive";
import { ACTION_LABELS, OBSERVATIONS, ROOMS } from "../game/content";
import { getRunHistory } from "../game/history";
import { playSound } from "../game/audio";
import { setMusicPlayback } from "../game/music";
import type { ExecutionEvent, HistoryEntry, Settings } from "../game/types";
import { DungeonCanvas } from "./DungeonCanvas";
import Modal from "./Modal";

type TimelineRow = { entries: HistoryEntry[]; repeated: boolean };

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
        if (active) {
          setRecords(items);
          setSelected((previous) =>
            previous
              ? (items.find((item) => item.id === previous.id) ?? previous)
              : null,
          );
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "지난 모험을 불러오지 못했어요.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [archives]);
  const available =
    current && !records.some((record) => record.id === current.id)
      ? [current, ...records]
      : records;
  return (
    <Modal title="우리의 모험 돌아보기" onClose={onClose}>
      <div className="chronicle">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {selected ? (
          <>
            <button
              type="button"
              className="secondary"
              onClick={() => setSelected(null)}
            >
              ← 지난 모험 목록
            </button>
            <ChronicleDetail
              key={selected.id}
              record={selected}
              settings={settings}
            />
          </>
        ) : (
          <>
            <p>넘어지고 다시 일어서며, 우리가 함께 남긴 기록이에요.</p>
            {loading && <p role="status">기록을 펼치고 있어요…</p>}
            {!loading && !available.length && !error && (
              <p>첫 여정을 마치면 여기에 모험 기록이 남아요.</p>
            )}
            <ul className="chronicle-archives">
              {available.map((record) => (
                <li key={record.id}>
                  <button type="button" onClick={() => setSelected(record)}>
                    <strong>{record.title}</strong>
                    <span>
                      {new Date(record.completedAt).toLocaleString("ko-KR")} ·{" "}
                      {record.save.state.deaths +
                        record.save.state.penaltyDeaths}
                      데스
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

function ChronicleDetail({
  record,
  settings,
}: {
  record: StageArchive;
  settings: Settings;
}) {
  const state = record.save.state;
  const history = useMemo(() => getRunHistory(state), [state]);
  const events = useMemo(
    () => new Map(state.events.map((event) => [event.id, event])),
    [state.events],
  );
  const lives = useMemo(() => {
    const grouped = new Map<number, TimelineRow[]>();
    for (const entry of history.entries) {
      const rows = grouped.get(entry.life) ?? [];
      const event =
        entry.kind === "action" ? events.get(entry.eventId) : undefined;
      const repeated =
        !!event?.repeated &&
        event.outcome === "safe" &&
        event.id !== state.lastEvent?.id;
      const previous = rows.at(-1);
      if (repeated && previous?.repeated) previous.entries.push(entry);
      else rows.push({ entries: [entry], repeated });
      grouped.set(entry.life, rows);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b);
  }, [history, events, state.lastEvent?.id]);
  const [replay, setReplay] = useState<{
    event: ExecutionEvent;
    nonce: number;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const player = useRef<HTMLElement>(null);
  useEffect(() => {
    if (replay) {
      player.current?.scrollIntoView({
        block: "nearest",
        behavior: settings.reducedMotion ? "instant" : "smooth",
      });
      player.current?.focus({ preventScroll: true });
    }
  }, [replay, settings.reducedMotion]);
  useEffect(() => {
    setMusicPlayback({ stageId: record.stageId, playing: !!replay && playing });
    return () => setMusicPlayback({ stageId: record.stageId, playing: false });
  }, [record.stageId, replay, playing]);
  const selectEvent = (event: ExecutionEvent) => {
    setFinished(false);
    setPlaying(true);
    setReplay((previous) => ({
      event: { ...event, repeated: false },
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  };
  const actionRow = (event: ExecutionEvent) => (
    <li key={event.id} className={`chronicle-action ${event.outcome}`}>
      <div>
        <small>
          {event.room + 1}번째 문 · {OBSERVATIONS[event.observation].label}
        </small>
        <blockquote>
          “{event.instructionText ?? "아무 말이 없으면 앞으로 걸어."}”
        </blockquote>
        <p>
          {ACTION_LABELS[event.action]} → {event.reason}
        </p>
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => selectEvent(event)}
        aria-label={`${event.room + 1}번째 문 ${OBSERVATIONS[event.observation].label} 장면 다시 보기`}
      >
        ▷ 다시 보기
      </button>
    </li>
  );
  const entryRow = (entry: HistoryEntry, key: number) => {
    if (entry.kind === "action") {
      const event = events.get(entry.eventId);
      return event ? actionRow(event) : null;
    }
    let text = "";
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
    return (
      <li
        className={`chronicle-change ${entry.kind}`}
        key={`${entry.revision}-${key}`}
      >
        {text}
      </li>
    );
  };
  return (
    <>
      <h3>{record.title}</h3>
      <p className="chronicle-summary">
        {state.deaths + state.penaltyDeaths}데스 · 사망·부활 {state.deaths} +
        삭제 비용 {state.penaltyDeaths} · {state.events.length}번의 행동
      </p>
      {!history.complete && (
        <p className="chronicle-legacy">
          이전 버전의 모험이에요. 행동 기록은 남아 있지만, 당시 메모를 쓰고
          지우거나 순서를 바꾼 이력은 남아 있지 않아요.
        </p>
      )}
      {history.initialInstructions.length > 0 && (
        <details className="chronicle-notes">
          <summary>
            {history.complete ? "처음 챙긴 메모" : "기록에 남은 메모"} ·{" "}
            {history.initialInstructions.length}줄
          </summary>
          <ul>
            {[...history.initialInstructions].reverse().map((note) => (
              <li key={note.id}>{note.text}</li>
            ))}
          </ul>
        </details>
      )}
      {replay && (
        <section
          className="chronicle-replay"
          ref={player}
          tabIndex={-1}
          aria-label="선택한 장면 다시 보기"
        >
          <div className="chronicle-replay-head">
            <strong>
              {replay.event.room + 1}번째 문 ·{" "}
              {OBSERVATIONS[replay.event.observation].label}
            </strong>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                finished
                  ? selectEvent(replay.event)
                  : setPlaying((value) => !value)
              }
            >
              {finished ? "다시 재생" : playing ? "일시정지" : "계속 보기"}
            </button>
          </div>
          <DungeonCanvas
            key={replay.nonce}
            event={replay.event}
            observation={OBSERVATIONS[replay.event.observation]}
            phase={
              replay.event.id === state.lastEvent?.id ? "cleared" : "running"
            }
            paused={!playing}
            reducedMotion={settings.reducedMotion}
            roomName={ROOMS[replay.event.room]?.name}
            onPlaybackEnd={() => {
              setPlaying(false);
              setFinished(true);
            }}
            onSound={(cue) => playSound(cue, settings.muted)}
          />
          <p>
            “{replay.event.instructionText ?? "아무 말이 없으면 앞으로 걸어."}”
          </p>
          <span>{replay.event.reason}</span>
        </section>
      )}
      {lives.map(([life, rows]) => (
        <section className="chronicle-life" key={life}>
          <h4>
            {life === 1 ? "첫 번째 생" : `${life}번째 생`}
            {life === lives.at(-1)?.[0] && <span>던전 탈출</span>}
          </h4>
          <ol>
            {rows.map((row, index) =>
              row.repeated ? (
                <li key={`repeat-${index}`} className="chronicle-repeat">
                  <details>
                    <summary>
                      익숙한 길 {row.entries.length}장면 무사히 통과 · 펼치기
                    </summary>
                    <ol>{row.entries.map((entry, i) => entryRow(entry, i))}</ol>
                  </details>
                </li>
              ) : (
                entryRow(row.entries[0], index)
              ),
            )}
          </ol>
        </section>
      ))}
      <details className="chronicle-notes" open>
        <summary>탈출할 때의 메모장 · 위쪽부터 우선</summary>
        <ul>
          {[...state.instructions].reverse().map((note) => (
            <li key={note.id}>{note.text}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
