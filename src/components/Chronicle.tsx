import { useEffect, useRef, useState, type ReactNode } from "react";
import { setMusicPlayback } from "../game/music";
import type { Settings } from "../game/types";

export interface ChronicleReplay<T> {
  id: string;
  title: string;
  quote: string;
  description: string;
  payload: T;
}

export type ChronicleEntry<T> =
  | {
      id: string;
      kind: "action";
      life: number;
      title: string;
      quote: string;
      description: string;
      outcome: string;
      repeated: boolean;
      replay: ChronicleReplay<T>;
    }
  | {
      id: string;
      kind: "change";
      life: number;
      change: "write" | "delete" | "reorder" | "revive" | "abandon";
      text: string;
    };

export interface ChronicleRow<T> {
  entries: ChronicleEntry<T>[];
  repeated: boolean;
}

export interface ChronicleLife<T> {
  number: number;
  rows: ChronicleRow<T>[];
  escaped: boolean;
}

export interface ChronicleViewModel<T> {
  title: string;
  summary: string;
  notice?: string;
  initialNotes?: { label: string; items: readonly { id: string; text: string }[] };
  finalNotes: { label: string; items: readonly { id: string; text: string }[] };
  lives: ChronicleLife<T>[];
}

export interface ChronicleReplayRenderProps<T> {
  replay: ChronicleReplay<T>;
  nonce: number;
  paused: boolean;
  reducedMotion: boolean;
  onPlaybackEnd: () => void;
}

/** Groups lives and only folds adjacent actions explicitly marked as repeats. */
export function groupChronicleEntries<T>(
  entries: readonly ChronicleEntry<T>[],
  escapedLife: number,
): ChronicleLife<T>[] {
  const grouped = new Map<number, ChronicleRow<T>[]>();
  for (const entry of entries) {
    const rows = grouped.get(entry.life) ?? [];
    if (entry.kind === "action" && entry.repeated && rows.at(-1)?.repeated) {
      rows.at(-1)!.entries.push(entry);
    } else {
      rows.push({ entries: [entry], repeated: entry.kind === "action" && entry.repeated });
    }
    grouped.set(entry.life, rows);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([number, rows]) => ({ number, rows, escaped: number === escapedLife }));
}

export function Chronicle<T>({
  model,
  settings,
  musicStageId,
  renderReplay,
}: {
  model: ChronicleViewModel<T>;
  settings: Settings;
  musicStageId: string;
  renderReplay: (props: ChronicleReplayRenderProps<T>) => ReactNode;
}) {
  const [selected, setSelected] = useState<{ replay: ChronicleReplay<T>; nonce: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const player = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!selected) return;
    player.current?.scrollIntoView({
      block: "nearest",
      behavior: settings.reducedMotion ? "instant" : "smooth",
    });
    player.current?.focus({ preventScroll: true });
  }, [selected, settings.reducedMotion]);

  useEffect(() => {
    setMusicPlayback({ stageId: musicStageId, playing: !!selected && playing });
    return () => setMusicPlayback({ stageId: musicStageId, playing: false });
  }, [musicStageId, selected, playing]);

  const selectReplay = (replay: ChronicleReplay<T>) => {
    setFinished(false);
    setPlaying(true);
    setSelected((previous) => ({ replay, nonce: (previous?.nonce ?? 0) + 1 }));
  };

  const actionRow = (entry: Extract<ChronicleEntry<T>, { kind: "action" }>) => (
    <li key={entry.id} className={`chronicle-action ${entry.outcome}`}>
      <div>
        <small>{entry.title}</small>
        <blockquote>“{entry.quote}”</blockquote>
        <p>{entry.description}</p>
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => selectReplay(entry.replay)}
        aria-label={`${entry.title} 장면 다시 보기`}
      >
        ▷ 다시 보기
      </button>
    </li>
  );

  const entryRow = (entry: ChronicleEntry<T>) =>
    entry.kind === "action" ? (
      actionRow(entry)
    ) : (
      <li className={`chronicle-change ${entry.change}`} key={entry.id}>
        {entry.text}
      </li>
    );

  return (
    <>
      <h3>{model.title}</h3>
      <p className="chronicle-summary">{model.summary}</p>
      {model.notice ? <p className="chronicle-legacy">{model.notice}</p> : null}
      {model.initialNotes?.items.length ? (
        <details className="chronicle-notes">
          <summary>
            {model.initialNotes.label} · {model.initialNotes.items.length}줄
          </summary>
          <ul>
            {[...model.initialNotes.items].reverse().map((note) => (
              <li key={note.id}>{note.text}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {selected ? (
        <section
          className="chronicle-replay"
          ref={player}
          tabIndex={-1}
          aria-label="선택한 장면 다시 보기"
        >
          <div className="chronicle-replay-head">
            <strong>{selected.replay.title}</strong>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                finished
                  ? selectReplay(selected.replay)
                  : setPlaying((value) => !value)
              }
            >
              {finished ? "다시 재생" : playing ? "일시정지" : "계속 보기"}
            </button>
          </div>
          {renderReplay({
            replay: selected.replay,
            nonce: selected.nonce,
            paused: !playing,
            reducedMotion: settings.reducedMotion,
            onPlaybackEnd: () => {
              setPlaying(false);
              setFinished(true);
            },
          })}
          <p>“{selected.replay.quote}”</p>
          <span>{selected.replay.description}</span>
        </section>
      ) : null}
      {model.lives.map((life) => (
        <section className="chronicle-life" key={life.number}>
          <h4>
            {life.number === 1 ? "첫 번째 생" : `${life.number}번째 생`}
            {life.escaped ? <span>던전 탈출</span> : null}
          </h4>
          <ol>
            {life.rows.map((row) =>
              row.repeated ? (
                <li key={`repeat-${row.entries[0].id}`} className="chronicle-repeat">
                  <details>
                    <summary>
                      익숙한 길 {row.entries.length}장면 무사히 통과 · 펼치기
                    </summary>
                    <ol>{row.entries.map(entryRow)}</ol>
                  </details>
                </li>
              ) : (
                entryRow(row.entries[0])
              ),
            )}
          </ol>
        </section>
      ))}
      <details className="chronicle-notes" open>
        <summary>{model.finalNotes.label}</summary>
        <ul>
          {[...model.finalNotes.items].reverse().map((note) => (
            <li key={note.id}>{note.text}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

export default Chronicle;
