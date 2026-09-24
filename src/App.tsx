import { PlayFooter } from "./components/PlayFooter";
import { chapterOneContactHint, chapterOneLearningHint } from "./game/hints/chapter-one";
import { PlayContactHint } from "./components/PlayContactHint";
import { postInterpretJson } from "./services/interpret-api";
import { useCallback, useEffect, useRef, useState } from "react";
import { isInterpretation } from "./game/interpretation";
import { DungeonCanvas } from "./components/DungeonCanvas";
import { StoryPrologue } from "./components/StoryPrologue";
import { MemoryNotebook } from "./components/MemoryNotebook";
import { PlayCommandComposer } from "./components/PlayCommandComposer";
import {
  PlayHelpDialog,
  PlaySettingsDialog,
  PlayShareDialog,
  PlayRestartDialog,
} from "./components/PlayDialogs";
import {
  PlayClearPanel,
  PlayDeathScore,
  PlayLaunchControls,
  PlaySceneFooter,
  PlaySceneCaption,
  PlaySceneHeading,
  PlaySessionControls,
} from "./components/PlaySessionControls";
import Modal from "./components/Modal";
import {
  PlayHeader,
  PlayUtilityActions,
  PlayHints,
  PlayIntro,
  PlayLayout,
  PlayStageProgress,
} from "./components/PlayChrome";
import {
  ACTION_LABELS,
  CONFIG,
  DUNGEON_VERSION,
  OBSERVATIONS,
  RULES_VERSION,
} from "./game/content";
import { roomsForRun } from "./game/chapter-layout";
import {
  abandon,
  addInstruction,
  currentObservation,
  deleteInstruction,
  moveInstruction,
  placeInstruction,
  newChapterRun,
  finishRetiredChapterTail,
  retry,
  score,
  startRun,
  step,
} from "./game/core";
import {
  loadSave,
  makeSave,
  STORAGE_KEY,
  writeSave,
  type StorageResult,
} from "./game/storage";
import { playSound, setAudioMuted, unlockAudio } from "./game/audio";
import { MEMORY_DUNGEON_STAGE_ID, setMusicPlayback } from "./game/music";
import type {
  Interpretation,
  Observation,
  Room,
  RunState,
  SaveData,
  Settings,
} from "./game/types";
import { usePlayCommand } from "./hooks/usePlayCommand";
import { useMobileKeyboardLayout } from "./hooks/useMobileKeyboardLayout";

type Popup = "help" | "settings" | "new" | "share" | "storage" | null;
const initialSettings: Settings = {
  muted: false,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};
const readBoot = () => {
  const r = loadSave();
  if (r.ok && r.value && (r.value.state.tutorial || !r.value.state.layoutVersion || r.value.state.layoutVersion === 1)) {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("one-line-per-death:legacy-onboarding:v1");
    } catch { /* Fresh play remains available if browser storage is unavailable. */ }
    return { data: null, error: "" };
  }
  return r.ok
    ? { data: r.value, error: "" }
    : {
        data: null,
        error: "저장된 기록을 읽을 수 없어요. 원본은 그대로 보관하고 있습니다.",
      };
};

function chapterHints(room: Room, observation: Observation): readonly string[] {
  const first = `“${room.subtitle}” — 먼저 ${observation.label}의 모양과 안전한 길을 살펴보세요.`;
  if (observation.sidePath) {
    return [
      first,
      "위와 아래가 함께 막혔다면, 오른편 표지판이 가리키는 다른 길을 떠올려 보세요.",
      "“위험이 함께 보이면 샛길로 가”처럼 상황과 행동을 한 줄로 이어 보세요.",
    ];
  }
  if (observation.ceilingSpikes) {
    return [
      first,
      "머리 위가 낮을 때는 몸의 높이를 줄이는 행동이 필요해요.",
      "“낮은 천장이 있으면 숙여”처럼 상황과 행동을 한 줄로 이어 보세요.",
    ];
  }
  if (observation.pit || observation.floorSpikes) {
    return [
      first,
      "발밑의 위험을 그대로 지나가기 어렵다면, 그 위를 넘는 행동을 떠올려 보세요.",
      `“${observation.label}이 있으면 뛰어”처럼 상황과 행동을 한 줄로 이어 보세요.`,
    ];
  }
  return [
    first,
    "앞을 막는 장애물이 없어도, 이곳에 맞는 지침이 있어야 용사가 움직여요.",
    "“평평한 길에서는 앞으로 가”처럼 상황과 행동을 한 줄로 이어 보세요.",
  ];
}

async function interpretChapterLine(
  text: string,
  signal: AbortSignal,
): Promise<Interpretation> {
  const data = await postInterpretJson("/api/interpret", {
    text, dungeonVersion: DUNGEON_VERSION, rulesVersion: RULES_VERSION,
  }, signal);
  const value: unknown = data && typeof data === "object" && "interpretation" in data ? data.interpretation : data;
  if (!isInterpretation(value)) {
    throw new Error("해석 응답이 올바르지 않아요. 다시 시도해 주세요.");
  }
  return value;
}

export interface ChapterOneStorageBridge {
  initial: SaveData | null;
  startWithStory?: boolean;
  save: (data: SaveData) => Promise<StorageResult<void>>;
  onRoadmap: () => void;
  onClearedPresentation: () => void;
  bestScore?: number | null;
}

export interface AppProps {
  bridge?: ChapterOneStorageBridge;
}

export default function App({ bridge }: AppProps = {}) {
  const [boot] = useState(() =>
    bridge ? { data: bridge.initial, error: "" } : readBoot(),
  );
  const [state, setState] = useState<RunState>(
    () => boot.data?.state ?? newChapterRun(),
  );
  const stateRef = useRef(state);
  const chapterRooms = roomsForRun(state);
  const [showStory, setShowStory] = useState(
    () => !boot.data || bridge?.startWithStory === true,
  );
  const [started, setStarted] = useState(false);
  const [settings, setSettings] = useState<Settings>(
    boot.data?.settings ?? initialSettings,
  );
  const settingsRef = useRef(settings);
  const [best, setBest] = useState<number | null>(bridge?.bestScore ?? boot.data?.best ?? null);
  const bestRef = useRef(best);
  const [tutorialCompleted] = useState(
    boot.data?.tutorialCompleted ?? false,
  );
  const completedRef = useRef(tutorialCompleted);
  const writer = useRef(crypto.randomUUID());
  const expected = useRef<
    (Pick<SaveData, "writer"> & { revision: number }) | null
  >(
    boot.data
      ? { writer: boot.data.writer, revision: boot.data.state.revision }
      : null,
  );
  const [storageError, setStorageError] = useState(boot.error);
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [reviving, setReviving] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [sceneMode, setSceneMode] = useState<"entrance" | "action">("action");
  const [sceneByScene, setSceneByScene] = useState(false);
  const [draft, setDraft] = useState("");
  const keyboard = useMobileKeyboardLayout(draft.length > 0);
  const [actionError, setActionError] = useState("");
  const [popup, setPopup] = useState<Popup>(null);
  const [shareInstructions, setShareInstructions] = useState(false);
  const [notice, setNotice] = useState("");
  const [sharedEntry, setSharedEntry] = useState(
    () => new URLSearchParams(location.search).get("challenge") === "new",
  );
  const busy = useRef(false);
  const saving = useRef(false);
  const presentedClears = useRef(new Set<string>());
  const stepModeRef = useRef(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    const handler = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);
  useEffect(() => {
    if (bridge) return;
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const d = JSON.parse(e.newValue);
          if (d.writer !== writer.current) {
            conflictRef.current = true;
            setConflict(true);
            setPaused(true);
          }
        } catch {
          conflictRef.current = true;
          setConflict(true);
          setPaused(true);
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [bridge]);
  useEffect(() => setAudioMuted(settings.muted), [settings.muted]);
  useEffect(() => {
    setMusicPlayback({
      stageId: MEMORY_DUNGEON_STAGE_ID,
      playing:
        started &&
        state.phase !== "cleared" &&
        !paused &&
        !popup &&
        !showHistory &&
        !hidden &&
        !conflict,
      intensity: state.room >= chapterRooms.length - 1
          ? "climax"
          : "main",
    });
  }, [
    started,
    state.phase,
    state.room,
    chapterRooms.length,
    paused,
    popup,
    showHistory,
    hidden,
    conflict,
  ]);
  useEffect(
    () => () =>
      setMusicPlayback({ stageId: MEMORY_DUNGEON_STAGE_ID, playing: false }),
    [],
  );
  const persist = useCallback(
    async (next: RunState) => {
      if (conflictRef.current) return false;
      let nextBest = bestRef.current;
      if (next.phase === "cleared" && !next.tutorial)
        nextBest =
          nextBest === null ? score(next) : Math.min(nextBest, score(next));
      const data = makeSave(next, {
        writer: writer.current,
        settings: settingsRef.current,
        best: nextBest,
        tutorialCompleted: completedRef.current,
      });
      let saved: StorageResult<unknown>;
      try {
        saved = bridge
          ? await bridge.save(data)
          : writeSave(data, { expected: expected.current });
      } catch (cause) {
        saved = {
          ok: false,
          error: {
            code: "write",
            message: "게임 상태를 저장하지 못했습니다.",
            cause,
          },
        };
      }
      if (!saved.ok) {
        setStorageError(
          "자동 저장을 완료하지 못했어요. 기록을 내보내거나 저장을 다시 시도해 주세요.",
        );
        if (saved.error.code === "conflict") {
          conflictRef.current = true;
          setConflict(true);
          setPaused(true);
        }
        return false;
      }
      if (!bridge)
        expected.current = { writer: writer.current, revision: next.revision };
      setStorageError("");
      bestRef.current = nextBest;
      setBest(nextBest);
      return true;
    },
    [bridge],
  );
  const commit = useCallback(
    async (next: RunState, afterSave?: () => void | Promise<void>) => {
      if (conflictRef.current || saving.current) return false;
      saving.current = true;
      try {
        if (!(await persist(next))) return false;
        await afterSave?.();
        stateRef.current = next;
        setState(next);
        return true;
      } finally {
        saving.current = false;
      }
    },
    [persist],
  );
  const presentCleared = useCallback(
    (completed: RunState) => {
      if (
        !bridge ||
        completed.tutorial ||
        completed.phase !== "cleared" ||
        presentedClears.current.has(completed.id)
      )
        return;
      presentedClears.current.add(completed.id);
      bridge.onClearedPresentation();
    },
    [bridge],
  );
  const cancelDraft = () => {
    cancelCommand();
    clearCommandError();
    setActionError("");
  };
  const changeDraft = (value: string) => {
    setDraft(value);
    clearCommandError();
    setActionError("");
  };
  const playNext = useCallback(async () => {
    if (conflictRef.current) return false;
    const current = stateRef.current;
    if (current.phase !== "running") {
      setAnimating(false);
      return false;
    }
    const next = step(current);
    if (await commit(next)) {
      setAnimating(next.events.length > current.events.length);
      if (next.phase === "cleared" && next.events.length === current.events.length) presentCleared(next);
      return true;
    }
    setAnimating(false);
    return false;
  }, [commit, presentCleared]);
  const onPlaybackEnd = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase === "running") {
      if (stepModeRef.current) {
        setAwaitingNext(true);
        setPaused(true);
      } else await playNext();
    } else {
      setAnimating(false);
      if (current.phase === "practice")
        playSound("win", settingsRef.current.muted);
      presentCleared(current);
    }
  }, [playNext, presentCleared]);
  const startPlayback = async () => {
    let next = stateRef.current;
    const revivingNext = next.phase === "dead";
    if (next.phase === "dead") {
      next = retry(next);
    }
    next = startRun(next);
    if (await commit(next)) {
      setNotice("");
      setAwaitingNext(false);
      setReviving(revivingNext);
      setSceneMode(revivingNext ? "entrance" : "action");
      setPaused(false);
      await playNext();
      return true;
    }
    return false;
  };
  const rememberAndGo = async (text: string, value: Interpretation) => {
    const next = addInstruction(stateRef.current, text, value);
    if (!(await commit(next))) return false;
    playSound("write", settingsRef.current.muted);
    setDraft("");
    setActionError("");
    await startPlayback();
    return true;
  };
  const {
    pending,
    error: commandError,
    submit: submitCommand,
    cancel: cancelCommand,
    clearError: clearCommandError,
  } = usePlayCommand<Interpretation>({
    contextKey: `${state.id}:${state.phase}:${state.room}:${state.deaths}:${state.tutorialStep}:${state.instructions.length}`,
    maxLength: CONFIG.maxInstructionLength,
    timeoutMs: CONFIG.requestTimeoutMs,
    blocked: !state.canWrite || conflict,
    interpret: interpretChapterLine,
    execute: (value, text) => rememberAndGo(text, value),
    onStart: () => {
      unlockAudio();
      setActionError("");
    },
  });
  const error = commandError || actionError;
  useEffect(() => {
    if (conflict) cancelCommand();
  }, [cancelCommand, conflict]);
  const launch = async () => {
    if (busy.current || pending || conflict) return;
    busy.current = true;
    unlockAudio();
    try {
      if (await startPlayback()) {
        cancelDraft();
        setDraft("");
      }
    } finally {
      busy.current = false;
    }
  };
  const begin = async () => {
    unlockAudio();
    if (sharedEntry) {
      const url = new URL(location.href);
      url.searchParams.delete("challenge");
      history.replaceState(null, "", url);
      setSharedEntry(false);
      if (boot.data) {
        await recoverAndRestart();
        return;
      }
    }
    if (boot.error) {
      setPopup("storage");
      return;
    }
    const completedTail = finishRetiredChapterTail(stateRef.current);
    if (completedTail !== stateRef.current && !(await commit(completedTail))) return;
    if (!boot.data && !(await commit(stateRef.current))) return;
    setStarted(true);
    setShowStory(false);
    if (stateRef.current.phase === "running") await playNext();
    else presentCleared(stateRef.current);
  };
  const changeSettings = async (next: Settings) => {
    if (busy.current || conflictRef.current) return;
    busy.current = true;
    const previous = settingsRef.current;
    settingsRef.current = next;
    try {
      if (
        await commit({
          ...stateRef.current,
          revision: stateRef.current.revision + 1,
        })
      )
        setSettings(next);
      else settingsRef.current = previous;
    } finally {
      busy.current = false;
    }
  };
  const erase = async (id: string) => {
    if (busy.current || conflict) return false;
    busy.current = true;
    try {
      const previous = stateRef.current;
      const next = deleteInstruction(previous, id);
      if (await commit(next)) {
        setNotice(
          previous.erasers === 0 && next.penaltyDeaths > previous.penaltyDeaths
            ? "여러 번 부활한 끝에, 한 줄의 기억이 사라졌어요."
            : "한 줄을 지웠어요. 빈자리에서도 다시 시작할 수 있어요.",
        );
        playSound("erase", settings.muted);
        return true;
      }
    } catch (cause) {
      setActionError(String(cause));
    } finally {
      busy.current = false;
    }
    return false;
  };
  const newChallenge = async () => {
    if (busy.current || conflictRef.current) return;
    busy.current = true;
    try {
      const next = newChapterRun();
      next.revision = stateRef.current.revision + 1;
      if (await commit(next)) {
        cancelDraft();
        setDraft("");
        setAnimating(false);
        setPaused(false);
        setNotice("");
        setAwaitingNext(false);
        setReviving(false);
        setSceneMode("action");
        setShowStory(true);
        setStarted(false);
        setPopup(null);
      }
    } finally {
      busy.current = false;
    }
  };
  const exportSave = () => {
    let raw = "";
    try {
      raw = bridge
        ? JSON.stringify(
            makeSave(stateRef.current, {
              writer: writer.current,
              settings: settingsRef.current,
              best: bestRef.current,
              tutorialCompleted: completedRef.current,
            }),
          )
        : (localStorage.getItem(STORAGE_KEY) ??
          JSON.stringify(
            makeSave(stateRef.current, {
              writer: writer.current,
              settings: settingsRef.current,
              best: bestRef.current,
              tutorialCompleted: completedRef.current,
            }),
          ));
    } catch {
      raw = JSON.stringify(stateRef.current);
    }
    const url = URL.createObjectURL(
      new Blob([raw], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "one-line-per-death-save.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const recoverAndRestart = async () => {
    if (bridge) {
      bridge.onRoadmap();
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && stateRef.current.phase !== "cleared")
        localStorage.setItem(`${STORAGE_KEY}.recovery.${Date.now()}`, raw);
      localStorage.removeItem(STORAGE_KEY);
      expected.current = null;
      setStorageError("");
      conflictRef.current = false;
      setConflict(false);
      await newChallenge();
    } catch {
      setStorageError(
        "원본을 안전하게 보관할 공간이 없어요. 먼저 기록을 내보내 주세요.",
      );
    }
  };
  const observation = currentObservation(state);
  const event = state.lastEvent;
  const noMatchingInstruction =
    state.phase === "blocked" && event?.outcome !== "blocked";
  const abandonedWithoutInstruction =
    state.phase === "dead" && (!event || event.outcome === "safe");
  const stoppedWithoutInstruction =
    noMatchingInstruction || abandonedWithoutInstruction;
  const contactHint = started && !animating ? chapterOneContactHint(state) : null;
  const displayedRoom = animating && event ? event.room : state.room;
  const learningHint = started ? chapterOneLearningHint(state, displayedRoom) : null;
  const stageNumber = Math.min(displayedRoom + 1, chapterRooms.length);
  const stageCount = chapterRooms.length;
  const room = chapterRooms[Math.min(displayedRoom, chapterRooms.length - 1)];
  const isRest =
    !animating && (state.phase === "ready" || state.phase === "dead");
  const canCompose = started && isRest && state.canWrite;
  const actualPhase = animating ? "running" : state.phase;
  const activeMemory =
    started && event
      ? (event.instructionText ?? "이전 버전의 자동 전진")
      : null;
  const completedEvents =
    animating && !awaitingNext ? state.events.slice(0, -1) : state.events;
  const canReorder = started && isRest && !pending && !conflict;
  const changePriority = async (id: string, direction: "up" | "down") => {
    if (!canReorder || busy.current) return false;
    busy.current = true;
    const next = moveInstruction(stateRef.current, id, direction);
    try {
      return next !== stateRef.current && (await commit(next));
    } finally {
      busy.current = false;
    }
  };
  const placePriority = async (
    id: string,
    targetId: string,
    position: "before" | "after",
  ) => {
    if (!canReorder || busy.current) return false;
    busy.current = true;
    const next = placeInstruction(stateRef.current, id, targetId, position);
    try {
      return next !== stateRef.current && (await commit(next));
    } finally {
      busy.current = false;
    }
  };
  const displayedDeaths =
    state.deaths - (animating && event?.outcome === "death" ? 1 : 0);
  const shareText = `죽을 때마다 한 줄\n${score(state)}데스로 던전 탈출!\n사망·자진 부활 ${state.deaths} + 삭제 패널티 ${state.penaltyDeaths}${
    shareInstructions
      ? "\n\n나의 메모장\n" +
        [...state.instructions]
          .reverse()
          .map((x) => x.text)
          .join("\n")
      : ""
  }\n\n${location.origin}${location.pathname}?challenge=new`;
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setNotice("공유 내용을 복사했어요.");
    } catch {
      setNotice(
        "복사를 허용하지 않는 브라우저예요. 위 내용을 선택해서 복사해 주세요.",
      );
    }
  };
  return (
    <div
      className={`shell ${keyboard ? "keyboard-open" : ""}`}
      onPointerDown={() => unlockAudio()}
    >
      <PlayHeader
        actions={
          <>
            {bridge && (
              <button
                className="subtle"
                onClick={() => {
                  cancelDraft();
                  bridge.onRoadmap();
                }}
              >
                여정 지도
              </button>
            )}
            <PlayUtilityActions
              muted={settings.muted}
              onHelp={() => setPopup("help")}
              onToggleSound={() => {
                unlockAudio();
                changeSettings({ ...settings, muted: !settings.muted });
              }}
              onSettings={() => setPopup("settings")}
            />
          </>
        }
      />
      <PlayIntro />
      {conflict && (
        <div className="banner" role="alert">
          다른 탭에서 기록이 바뀌어 이 탭을 멈췄어요. 최신 기록을 불러오면
          이어갈 수 있어요.{" "}
          <button className="secondary" onClick={() => location.reload()}>
            최신 기록 불러오기
          </button>
        </div>
      )}
      {storageError && (
        <div className="banner" role="alert">
          {storageError}{" "}
          <button className="secondary" onClick={() => setPopup("storage")}>
            기록 복구
          </button>
        </div>
      )}
      {showStory && !started ? (
        <StoryPrologue
          onRead={() => void begin()}
          onSkip={() => void begin()}
          disabled={conflict}
        />
      ) : (
      <>
      <PlayLayout>
        <section className="game-panel" aria-label="던전 플레이">
          <div
            className={`scene-frame ${OBSERVATIONS[event?.observation ?? observation.id].sidePath && sceneMode !== "entrance" ? "has-side-path" : ""}`}
          >
            <PlaySceneHeading eyebrow={`첫 번째 여정 · STAGE 1-${stageNumber}`} title={room.name}>
              <span className="chapter-number">{stageNumber} / {stageCount}</span>
            </PlaySceneHeading>
            <div className="canvas-holder">
              <DungeonCanvas
                key={stoppedWithoutInstruction ? "waiting-for-instruction" : "playing-instruction"}
                observation={observation}
                event={started && !stoppedWithoutInstruction ? event : null}
                phase={started ? state.phase : "title"}
                paused={paused || hidden || conflict || !!popup || showHistory}
                reducedMotion={settings.reducedMotion}
                onPlaybackEnd={onPlaybackEnd}
                onSceneModeChange={(mode) => {
                  setSceneMode(mode);
                  setReviving(mode === "entrance");
                }}
                onSound={(cue) => playSound(cue, settingsRef.current.muted)}
                roomName={room.name}
              />
            </div>
            {started &&
              (animating ||
                state.phase === "dead" ||
                state.phase === "blocked") && (
                <PlaySceneCaption returning={sceneMode === "entrance"} accident={!animating && state.phase === "dead" && !abandonedWithoutInstruction} animating={animating}
                  kicker={stoppedWithoutInstruction ? abandonedWithoutInstruction ? "멈춘 자리에서 부활했어요" : "여기서 멈췄어요" : sceneMode === "entrance" ? "다시, 던전 입구에서" : !animating ? "방금 무슨 일이 있었냐면…" : `기억한 말 · ${OBSERVATIONS[event?.observation ?? observation.id].label}`}
                  memory={stoppedWithoutInstruction ? "이곳에 맞는 지침이 없었어요." : sceneMode === "entrance" ? "몸은 다시 태어나도, 메모는 꼭 챙겨 갈게." : `“${activeMemory}”`}
                  action={stoppedWithoutInstruction ? abandonedWithoutInstruction ? "새 지침을 쓰고 입구에서 다시 출발할 수 있어요." : "용사는 이동하지 않았어요. 포기하고 부활하면 다음 지침을 쓸 수 있어요." : sceneMode === "entrance" ? "처음부터 다시 걸어가요" : !animating ? event?.reason : event ? ACTION_LABELS[event.action] : null}>
                  <PlayContactHint text={contactHint?.text ?? null} className={contactHint?.key === "combined-hazards" ? "route-hint" : undefined} />
                </PlaySceneCaption>
              )}
            {!started && (
              <div className="title-start">
                <button className="primary" onClick={begin} disabled={conflict}>
                  {sharedEntry && boot.data
                    ? "새 모험 시작"
                    : boot.data
                      ? "모험 이어하기"
                      : "첫 번째 한 줄 남기기"}{" "}
                  <span>→</span>
                </button>
                {boot.data && (
                  <button className="secondary" onClick={() => setPopup("new")}>
                    새 도전
                  </button>
                )}
              </div>
            )}
            <PlaySceneFooter
              status={
                !started
                  ? "한 줄에서 시작되는 모험"
                  : pending
                    ? "용사가 한 줄을 읽고 있어요"
                    : paused || hidden
                      ? "잠시 쉬어가는 중"
                      : animating && event?.repeated
                        ? "기억하는 길 · 3배속"
                        : actualPhase === "dead"
                          ? abandonedWithoutInstruction ? "새 지침을 쓸 수 있어요" : "넘어진 자리에도 기억은 남아"
                          : noMatchingInstruction
                            ? "맞는 지침을 기다리는 중"
                          : actualPhase === "cleared"
                            ? "던전 탈출 성공 · 모든 한 줄의 기억"
                            : "천천히, 한 걸음씩"
              }
              playing={started && (animating || state.phase === "running")}
              paused={paused}
              label="기억의 던전"
              onTogglePause={async () => {
                if (awaitingNext) {
                  if (await playNext()) {
                    setAwaitingNext(false);
                    setPaused(false);
                  }
                } else setPaused((value) => !value);
              }}
            />
          </div>
          {started && (
            <PlaySessionControls
              sceneByScene={sceneByScene}
              onSceneByScene={async (value) => {
                setSceneByScene(value);
                stepModeRef.current = value;
                if (!value && awaitingNext && (await playNext())) {
                  setAwaitingNext(false);
                  setPaused(false);
                }
              }}
              awaitingNext={awaitingNext}
              onNext={async () => {
                if (await playNext()) {
                  setAwaitingNext(false);
                  setPaused(false);
                }
              }}
              hasHistory={completedEvents.length > 0}
              onHistory={() => {
                setShowHistory(true);
                setPaused(true);
              }}
            />
          )}
          {!started && (
            <ol className="first-guide">
              <li>
                <b>01</b>
                <span>
                  용사에게 한 줄을 써요.
                  <small>용사는 네 말을 그대로 믿어요.</small>
                </span>
              </li>
              <li>
                <b>02</b>
                <span>
                  넘어지면 한 줄을 더.
                  <small>몸은 부활해도 기억은 남아요.</small>
                </span>
              </li>
              <li>
                <b>03</b>
                <span>
                  쌓인 기억으로 문 너머까지.
                  <small>함께 배우며 던전을 탈출해요.</small>
                </span>
              </li>
            </ol>
          )}
          <PlayStageProgress
            chapter={1}
            stages={chapterRooms.map((chapterRoom, index) => ({ id: `main:${index}`, title: chapterRoom.name }))}
            currentId={`main:${Math.min(displayedRoom, chapterRooms.length - 1)}`}
            completedIds={chapterRooms.slice(0, !animating && state.phase === "cleared" ? chapterRooms.length : displayedRoom).map((_, index) => `main:${index}`)}
          />
          {learningHint && <p className="chapter-learning-hint" role="note">{learningHint}</p>}
          {canCompose && (
            <>
              <PlayCommandComposer
                id="instruction"
                value={draft}
                onChange={changeDraft}
                onSubmit={submitCommand}
                onCancel={cancelCommand}
                pending={pending}
                error={error}
                disabled={conflict}
                maxLength={CONFIG.maxInstructionLength}
                label="이번 생에서 남길 한 줄"
                placeholder={state.instructions.length === 0 ? "앞으로 전진해" : "이럴 때는, 이렇게 해줘…"}
              />
              <PlayHints
                hints={chapterHints(room, observation)}
                resetKey={`${displayedRoom}:${observation.id}`}
              />
            </>
          )}
          {started &&
            isRest &&
            !(state.instructions.length === 0 && state.deaths === 0) && (
              <PlayLaunchControls
                dead={state.phase === "dead"}
                canWrite={state.canWrite}
                disabled={
                  pending ||
                  conflict
                }
                onLaunch={launch}
              />
            )}
          {started && !animating && state.phase === "blocked" && (
            <button
              className="primary wide"
              onClick={async () => {
                await commit(abandon(stateRef.current));
              }}
              disabled={conflict}
            >
              부활하고 · +1데스
            </button>
          )}
          {started && !animating && state.phase === "cleared" && (
            <PlayClearPanel
              deaths={state.deaths}
              penaltyDeaths={state.penaltyDeaths}
              best={best}
              onShare={() => {
                setNotice("");
                setPopup("share");
              }}
              onNew={() => setPopup("new")}
            />
          )}
          {notice && (
            <p className="helper" role="status">
              {notice}
            </p>
          )}
          <PlayDeathScore
            deaths={displayedDeaths}
            penaltyDeaths={state.penaltyDeaths}
            best={best}
          />
        </section>
        <MemoryNotebook
          entries={[...state.instructions].reverse().map((item) => ({
            id: item.id,
            text: item.text,
            actionLabel: ACTION_LABELS[item.interpretation.action],
          }))}
          erasers={state.erasers}
          eraserCapacity={CONFIG.initialErasers}
          deletionPenalty={CONFIG.deletionPenalty}
          activeId={started ? event?.instructionId : undefined}
          animating={animating}
          reviving={reviving}
          canDelete={
            started &&
            state.phase === "dead" &&
            !animating &&
            !pending &&
            !conflict
          }
          canReorder={canReorder}
          reducedMotion={settings.reducedMotion}
          onDelete={erase}
          onMove={changePriority}
          onPlace={placePriority}
        />
      </PlayLayout>
      </>
      )}
      <PlayFooter local={!bridge} onRestart={() => setPopup("new")} disabled={pending || conflict} />
      {showHistory && (
        <Modal
          title="용사가 기억한 순간들"
          onClose={() => setShowHistory(false)}
        >
          <p>장면은 잠시 멈췄어요. 읽은 뒤 재생 버튼으로 계속할 수 있어요.</p>
          <ol className="event-history">
            {completedEvents
              .slice(-8)
              .reverse()
              .map((e) => (
                <li key={e.id}>
                  <small>
                    {`${e.room + 1}번째 문`} ·{" "}
                    {OBSERVATIONS[e.observation].label}
                  </small>
                  <blockquote>{e.instructionText ?? "이전 버전의 자동 전진"}</blockquote>
                  <p>
                    {ACTION_LABELS[e.action]} → {e.reason}
                  </p>
                </li>
              ))}
          </ol>
        </Modal>
      )}
      {popup === "help" && (
        <PlayHelpDialog
          campaign={Boolean(bridge)}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === "settings" && (
        <PlaySettingsDialog
          settings={settings}
          onChange={changeSettings}
          onExport={exportSave}
          onNew={() => setPopup("new")}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === "new" && <PlayRestartDialog firstChapter onRestart={() => void newChallenge()}
        disabled={pending || conflict} onClose={() => setPopup(null)} />}
      {popup === "storage" && (
        <Modal title="기록을 안전하게 보관해요" onClose={() => setPopup(null)}>
          <p>
            {storageError || "현재 기록을 파일로 보관할 수 있어요."} 기존
            데이터는 자동으로 지우지 않습니다.
          </p>
          <div className="action-row">
            <button className="primary" onClick={exportSave}>
              원본 기록 내보내기
            </button>
            <button
              className="secondary"
              onClick={async () => {
                if (await commit(stateRef.current)) {
                  setPopup(null);
                  if (stateRef.current.phase === "running") await playNext();
                }
              }}
            >
              저장 다시 시도
            </button>
            {bridge ? (
              <button className="secondary" onClick={bridge.onRoadmap}>
                여정 지도로 돌아가기
              </button>
            ) : (
              <button className="secondary" onClick={recoverAndRestart}>
                원본 별도 보관 후 새 도전
              </button>
            )}
          </div>
        </Modal>
      )}
      {popup === "share" && (
        <PlayShareDialog
          text={shareText}
          includeNotes={shareInstructions}
          onIncludeNotes={setShareInstructions}
          notice={notice}
          onCopy={copyShare}
          onSystemShare={
            typeof navigator.share === "function"
              ? () =>
                  void navigator
                    .share({ title: "죽을 때마다 한 줄", text: shareText })
                    .catch(() => setNotice("공유를 취소했어요."))
              : undefined
          }
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
