import { useCallback, useEffect, useRef, useState } from "react";
import { isInterpretation } from "./game/interpretation";
import { PrologueGuide } from "./components/PrologueGuide";
import { DungeonCanvas } from "./components/DungeonCanvas";
import { LegacyOnboarding } from "./components/LegacyOnboarding";
import { PlayCommandComposer } from "./components/PlayCommandComposer";
import Modal from "./components/Modal";
import {
  PlayHeader,
  PlayUtilityActions,
  PlayHints,
  PlayIntro,
  PlayLayout,
  PlayNotebook,
  PlayStageProgress,
} from "./components/PlayChrome";
import StageChronicle from "./components/StageChronicle";
import { archiveStage, stageArchive, type StageArchive } from "./game/archive";
import {
  ACTION_LABELS,
  CONFIG,
  DUNGEON_VERSION,
  OBSERVATIONS,
  ROOMS,
  RULES_VERSION,
  TUTORIAL_ROOM,
} from "./game/content";
import {
  abandon,
  addInstruction,
  currentObservation,
  deleteInstruction,
  moveInstruction,
  placeInstruction,
  newRun,
  practiceDeletion,
  retry,
  score,
  skipTutorial,
  startMain,
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
import {
  ONBOARDING_STAGES,
  attachOnboardingHandoff,
  createOnboardingProgress,
  loadOnboardingProgress,
  progressBelongsToRun,
  writeOnboardingProgress,
  type OnboardingProgress,
} from "./game/onboarding";
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

type Popup = "help" | "settings" | "new" | "share" | "storage" | null;
const initialSettings: Settings = {
  muted: false,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};
const readBoot = () => {
  const r = loadSave();
  return r.ok
    ? { data: r.value, error: "" }
    : {
        data: null,
        error: "저장된 기록을 읽을 수 없어요. 원본은 그대로 보관하고 있습니다.",
      };
};

function legacyHints(room: Room, observation: Observation): readonly string[] {
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
    "지금은 앞을 막는 장애물이 없어요. 용사는 말이 없어도 앞으로 걸어요.",
    "새 행동을 덧붙이기 전에, 기본 전진으로 지나갈 수 있는지 먼저 확인해 보세요.",
  ];
}

async function interpretOnboardingLine(
  text: string,
  signal: AbortSignal,
): Promise<Interpretation> {
  const response = await fetch("/api/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      dungeonVersion: DUNGEON_VERSION,
      rulesVersion: RULES_VERSION,
    }),
    signal,
  });
  if (response.status === 429) {
    throw new Error("요청이 잠시 몰렸어요. 1분 뒤 다시 시도해 주세요.");
  }
  const data = await response.json().catch(() => {
    throw new Error("해석 서버의 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.");
  });
  if (!response.ok) {
    throw new Error(
      data?.error?.message ?? data?.message ?? "뜻을 확인하지 못했어요.",
    );
  }
  const value: unknown = data?.interpretation ?? data;
  if (!isInterpretation(value)) {
    throw new Error("해석 응답이 올바르지 않아요. 다시 시도해 주세요.");
  }
  return value;
}

export interface LegacyStorageBridge {
  initial: SaveData | null;
  save: (data: SaveData) => Promise<StorageResult<void>>;
  loadOnboarding?: () => OnboardingProgress | null;
  saveOnboarding?: (
    progress: OnboardingProgress,
  ) => Promise<StorageResult<void>>;
  onRoadmap: () => void;
  onClearedPresentation: () => void;
  onArchive: () => void;
}

export interface AppProps {
  bridge?: LegacyStorageBridge;
}

export default function App({ bridge }: AppProps = {}) {
  const [boot] = useState(() =>
    bridge ? { data: bridge.initial, error: "" } : readBoot(),
  );
  const [state, setState] = useState<RunState>(
    () => boot.data?.state ?? newRun(true),
  );
  const stateRef = useRef(state);
  const [onboardingProgress, setOnboardingProgress] =
    useState<OnboardingProgress | null>(() => {
      let stored: OnboardingProgress | null = null;
      try {
        stored = bridge?.loadOnboarding
          ? bridge.loadOnboarding()
          : loadOnboardingProgress();
      } catch {
        stored = null;
      }
      if (!boot.data) return createOnboardingProgress(state.id);
      return progressBelongsToRun(stored, state.id) ? stored : null;
    });
  const onboardingActive =
    state.tutorial && onboardingProgress?.ownerRunId === state.id;
  const [onboardingReady, setOnboardingReady] = useState(
    () => !onboardingActive || boot.data !== null,
  );
  const [onboardingInitAttempt, setOnboardingInitAttempt] = useState(0);
  const initializingOnboarding = useRef(false);
  const [started, setStarted] = useState(false);
  const [settings, setSettings] = useState<Settings>(
    boot.data?.settings ?? initialSettings,
  );
  const settingsRef = useRef(settings);
  const [best, setBest] = useState<number | null>(boot.data?.best ?? null);
  const bestRef = useRef(best);
  const [tutorialCompleted, setTutorialCompleted] = useState(
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
  const [keyboard, setKeyboard] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [reviving, setReviving] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [sceneMode, setSceneMode] = useState<"entrance" | "action">("action");
  const [sceneByScene, setSceneByScene] = useState(false);
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState("");
  const [popup, setPopup] = useState<Popup>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [shareInstructions, setShareInstructions] = useState(false);
  const [notice, setNotice] = useState("");
  const practiceCount =
    state.phase === "practice" ? Math.max(0, state.tutorialStep - 5) : 0;
  const [sharedEntry, setSharedEntry] = useState(
    () => new URLSearchParams(location.search).get("challenge") === "new",
  );
  const busy = useRef(false);
  const saving = useRef(false);
  const presentedClears = useRef(new Set<string>());
  const notebook = useRef<HTMLDetailsElement>(null);
  const stepModeRef = useRef(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [chronicleRecord, setChronicleRecord] = useState<StageArchive | null>(
    null,
  );
  const [archiveError, setArchiveError] = useState("");
  const archivedRuns = useRef(new Set<string>());
  const [priorityNotice, setPriorityNotice] = useState("");
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [draggedMemory, setDraggedMemory] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const dragRef = useRef<string | null>(null);
  const dropRef = useRef<{ id: string; position: "before" | "after" } | null>(
    null,
  );
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
    if (showChronicle) return;
    setMusicPlayback({
      stageId: MEMORY_DUNGEON_STAGE_ID,
      playing:
        (started || onboardingActive) &&
        state.phase !== "cleared" &&
        !paused &&
        !hidden &&
        !conflict,
      intensity: onboardingActive
        ? "intro"
        : state.room >= ROOMS.length - 1
          ? "climax"
          : "main",
    });
  }, [
    started,
    onboardingActive,
    state.phase,
    state.room,
    paused,
    hidden,
    conflict,
    showChronicle,
  ]);
  useEffect(
    () => () =>
      setMusicPlayback({ stageId: MEMORY_DUNGEON_STAGE_ID, playing: false }),
    [],
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 801px)");
    const change = () => {
      if (query.matches && notebook.current) notebook.current.open = true;
    };
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    let fullHeight = window.innerHeight;
    const viewport = window.visualViewport;
    const update = () => {
      fullHeight = Math.max(fullHeight, window.innerHeight);
      setKeyboard(
        window.innerWidth <= 800 &&
          document.activeElement?.tagName === "TEXTAREA" &&
          (viewport?.height ?? window.innerHeight) < fullHeight * 0.78,
      );
    };
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  useEffect(() => {
    if (!notebook.current?.open || window.innerWidth <= 800) return;
    const list =
      notebook.current.querySelector<HTMLUListElement>(".instruction-list");
    const active = list?.querySelector<HTMLElement>(".instruction.active");
    if (list && active) {
      const top =
        active.getBoundingClientRect().top -
        list.getBoundingClientRect().top +
        list.scrollTop;
      list.scrollTo({
        top: Math.max(0, top - 8),
        behavior: settings.reducedMotion ? "instant" : "smooth",
      });
    }
  }, [state.lastEvent?.id, settings.reducedMotion]);
  const persist = useCallback(async (next: RunState) => {
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
  }, [bridge]);
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
  const persistOnboarding = useCallback(
    async (next: OnboardingProgress) => {
      let saved: StorageResult<void>;
      try {
        saved = bridge?.saveOnboarding
          ? await bridge.saveOnboarding(next)
          : writeOnboardingProgress(next);
      } catch (cause) {
        saved = {
          ok: false,
          error: {
            code: "write",
            message: "도입 기록을 저장하지 못했어요.",
            cause,
          },
        };
      }
      if (!saved.ok) {
        setStorageError(
          "정식 도입 기록을 저장하지 못했어요. 현재 장면에서 다시 시도해 주세요.",
        );
        return false;
      }
      setOnboardingProgress(next);
      setStorageError("");
      return true;
    },
    [bridge],
  );
  useEffect(() => {
    if (
      !onboardingActive ||
      onboardingReady ||
      boot.data ||
      !onboardingProgress ||
      initializingOnboarding.current
    ) {
      return;
    }
    initializingOnboarding.current = true;
    void (async () => {
      try {
        // The separate onboarding owner record must exist before the fresh
        // legacy save, otherwise a reload could mistake it for an old save.
        if (!(await persistOnboarding(onboardingProgress))) return;
        if (!(await persist(stateRef.current))) return;
        setOnboardingReady(true);
      } finally {
        initializingOnboarding.current = false;
      }
    })();
  }, [
    boot.data,
    onboardingActive,
    onboardingInitAttempt,
    onboardingProgress,
    onboardingReady,
    persist,
    persistOnboarding,
  ]);
  const archiveCleared = useCallback(async (completed: RunState) => {
    if (
      completed.phase !== "cleared" ||
      completed.tutorial ||
      archivedRuns.current.has(completed.id)
    )
      return true;
    if (bridge) return true;
    try {
      await archiveStage(
        makeSave(completed, {
          writer: writer.current,
          settings: settingsRef.current,
          best: bestRef.current,
          tutorialCompleted: completedRef.current,
        }),
      );
      archivedRuns.current.add(completed.id);
      setArchiveError("");
      return true;
    } catch {
      setArchiveError(
        "완료한 모험을 보관하지 못했어요. 현재 기록은 남아 있으니 다시 시도해 주세요.",
      );
      return false;
    }
  }, [bridge]);
  useEffect(() => {
    if (started && state.phase === "cleared" && !state.tutorial)
      void archiveCleared(state);
  }, [started, state, archiveCleared]);
  const openChronicle = (includeCurrent: boolean) => {
    setPaused(true);
    setMusicPlayback({ stageId: MEMORY_DUNGEON_STAGE_ID, playing: false });
    if (bridge) {
      bridge.onArchive();
      return;
    }
    setChronicleRecord(
      includeCurrent && stateRef.current.phase === "cleared"
        ? stageArchive(
            makeSave(stateRef.current, {
              writer: writer.current,
              settings: settingsRef.current,
              best: bestRef.current,
              tutorialCompleted: completedRef.current,
            }),
          )
        : null,
    );
    setShowChronicle(true);
  };
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
      setAnimating(true);
      return true;
    }
    setAnimating(false);
    return false;
  }, [commit]);
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
      setEditingMemory(null);
      setDraggedMemory(null);
      setDropTarget(null);
      dragRef.current = null;
      dropRef.current = null;
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
    interpret: interpretOnboardingLine,
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
        await archiveAndRestart();
        return;
      }
    }
    if (boot.error) {
      setPopup("storage");
      return;
    }
    if (!boot.data && !(await commit(stateRef.current))) return;
    setStarted(true);
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
  const erase = async () => {
    if (!deleteId || busy.current || conflict) return;
    busy.current = true;
    try {
      const next = deleteInstruction(stateRef.current, deleteId);
      if (
        await commit(next, async () => {
          setErasing(true);
          await new Promise((resolve) =>
            setTimeout(resolve, settings.reducedMotion ? 0 : 220),
          );
        })
      ) {
        setNotice(
          stateRef.current.erasers === 0 &&
            next.penaltyDeaths > state.penaltyDeaths
            ? "여러 번 부활한 끝에, 한 줄의 기억이 사라졌어요."
            : "한 줄을 지웠어요. 빈자리에서도 다시 시작할 수 있어요.",
        );
        playSound("erase", settings.muted);
        setDeleteId(null);
      }
    } catch (cause) {
      setActionError(String(cause));
    } finally {
      busy.current = false;
      setErasing(false);
    }
  };
  const newChallenge = async () => {
    if (busy.current || conflictRef.current) return;
    busy.current = true;
    if (!(await archiveCleared(stateRef.current))) {
      busy.current = false;
      setPopup(null);
      return;
    }
    try {
      const next = newRun(true);
      next.revision = stateRef.current.revision + 1;
      const freshOnboarding = createOnboardingProgress(next.id);
      if (
        (await persistOnboarding(freshOnboarding)) &&
        (await commit(next))
      ) {
        cancelDraft();
        setDraft("");
        setAnimating(false);
        setPaused(false);
        setNotice("");
        setOnboardingReady(true);
        setStarted(true);
        setPopup(null);
      }
    } finally {
      busy.current = false;
    }
  };
  const enterMain = async () => {
    if (busy.current || conflict) return;
    busy.current = true;
    const previous = completedRef.current;
    try {
      const next = startMain(stateRef.current);
      completedRef.current = true;
      if (await commit(next)) {
        setTutorialCompleted(true);
        setNotice("가르친 두 줄을 챙겼어요. 이제 진짜 모험을 시작해요.");
      } else completedRef.current = previous;
    } catch (cause) {
      completedRef.current = previous;
      setStorageError(
        cause instanceof Error ? cause.message : "본편으로 이동하지 못했어요.",
      );
    } finally {
      busy.current = false;
    }
  };
  const completeFormalOnboarding = async (
    completed: OnboardingProgress,
  ) => {
    if (busy.current || conflictRef.current) return;
    busy.current = true;
    const previous = completedRef.current;
    try {
      const next = skipTutorial(stateRef.current);
      const handedOff = attachOnboardingHandoff(completed, next.id);
      if (!(await persistOnboarding(handedOff))) return;
      completedRef.current = true;
      if (await commit(next)) {
        setTutorialCompleted(true);
        setStarted(true);
        setPaused(false);
        setNotice(
          "네 번의 첫걸음을 마쳤어요. 빈 메모장과 지우개 두 개로 1-5를 시작해요.",
        );
      } else {
        completedRef.current = previous;
      }
    } catch (cause) {
      completedRef.current = previous;
      setStorageError(
        cause instanceof Error
          ? cause.message
          : "본편으로 이동하지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      busy.current = false;
    }
  };
  const skipPrologue = async () => {
    if (busy.current || conflictRef.current || !stateRef.current.tutorial)
      return;
    busy.current = true;
    const previous = completedRef.current;
    cancelDraft();
    try {
      const next = skipTutorial(stateRef.current);
      completedRef.current = true;
      if (await commit(next)) {
        setDraft("");
        setAnimating(false);
        setAwaitingNext(false);
        setPaused(false);
        setReviving(false);
        setSceneMode("action");
        setTutorialCompleted(true);
        setStarted(true);
        setNotice("프롤로그를 건너뛰었어요. 빈 메모장으로 첫 모험을 시작해요.");
      } else completedRef.current = previous;
    } catch (cause) {
      completedRef.current = previous;
      setStorageError(
        cause instanceof Error
          ? cause.message
          : "프롤로그를 건너뛰지 못했어요.",
      );
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
  const archiveAndRestart = async () => {
    if (bridge) {
      bridge.onRoadmap();
      return;
    }
    if (!(await archiveCleared(stateRef.current))) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw)
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
  const showDetourHint =
    started &&
    !animating &&
    !state.tutorial &&
    state.phase === "dead" &&
    event?.outcome === "death" &&
    OBSERVATIONS[event.observation].sidePath &&
    state.events.find((record) => OBSERVATIONS[record.observation].sidePath)
      ?.id === event.id;
  const displayedRoom = animating && event ? event.room : state.room;
  const room = state.tutorial
    ? TUTORIAL_ROOM
    : ROOMS[Math.min(displayedRoom, ROOMS.length - 1)];
  const isRest =
    !animating && (state.phase === "ready" || state.phase === "dead");
  const canCompose = started && isRest && state.canWrite;
  const actualPhase = animating ? "running" : state.phase;
  const activeMemory =
    started && event
      ? (event.instructionText ?? "아무 말이 없으면 앞으로 걸어.")
      : null;
  const completedEvents =
    animating && !awaitingNext ? state.events.slice(0, -1) : state.events;
  const canReorder = started && isRest && !pending && !conflict;
  const changePriority = async (id: string, direction: "up" | "down") => {
    if (!canReorder || busy.current) return;
    busy.current = true;
    const next = moveInstruction(stateRef.current, id, direction);
    try {
      if (next !== stateRef.current && (await commit(next))) {
        const text = next.instructions.find((item) => item.id === id)?.text;
        setPriorityNotice(
          `“${text}” 우선순위를 ${direction === "up" ? "높였어요" : "낮췄어요"}.`,
        );
      }
    } finally {
      busy.current = false;
    }
  };
  const startMemoryDrag = (id: string) => {
    if (!canReorder) return false;
    dragRef.current = id;
    setDraggedMemory(id);
    setEditingMemory(null);
    return true;
  };
  const targetMemoryDrag = (clientX: number, clientY: number) => {
    if (!dragRef.current || !canReorder) return;
    const list =
      notebook.current?.querySelector<HTMLElement>(".instruction-list");
    if (list) {
      const bounds = list.getBoundingClientRect();
      if (clientY < bounds.top + 28) list.scrollTop -= 18;
      else if (clientY > bounds.bottom - 28) list.scrollTop += 18;
    }
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-memory-id]");
    const id = row?.dataset.memoryId;
    if (!row || !id || id === dragRef.current) {
      dropRef.current = null;
      setDropTarget(null);
      return;
    }
    const bounds = row.getBoundingClientRect();
    const target = {
      id,
      position:
        clientY < bounds.top + bounds.height / 2
          ? ("before" as const)
          : ("after" as const),
    };
    dropRef.current = target;
    setDropTarget(target);
  };
  const finishMemoryDrag = async (apply: boolean) => {
    const id = dragRef.current;
    const target = dropRef.current;
    if (apply && canReorder && id && target) {
      const next = placeInstruction(
        stateRef.current,
        id,
        target.id,
        target.position,
      );
      if (next !== stateRef.current && (await commit(next)))
        setPriorityNotice("메모 우선순위를 바꿨어요.");
    }
    dragRef.current = null;
    dropRef.current = null;
    setDraggedMemory(null);
    setDropTarget(null);
  };
  const displayedDeaths =
    state.deaths - (animating && event?.outcome === "death" ? 1 : 0);
  const selected = state.instructions.find((x) => x.id === deleteId);
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
  if (onboardingActive && onboardingProgress) {
    return (
      <div
        className={`shell ${keyboard ? "keyboard-open" : ""}`}
        onPointerDown={() => unlockAudio()}
      >
        <PlayHeader
          actions={
            <>
              {bridge && (
                <button className="subtle" onClick={bridge.onRoadmap}>
                  여정 지도
                </button>
              )}
              <PlayUtilityActions
                muted={settings.muted}
                onHelp={() => setPopup("help")}
                onToggleSound={() => {
                  if (!onboardingReady || conflict) return;
                  unlockAudio();
                  void changeSettings({
                    ...settings,
                    muted: !settings.muted,
                  });
                }}
                onSettings={() => setPopup("settings")}
              />
            </>
          }
        />
        <PlayIntro
          description="이야기를 지나, 네 가지 첫걸음을 몸으로 익혀요."
          aside={
            <>
              기억의 던전 · 정식 도입
              <small>CHAPTER 1 · STAGE 1–4</small>
            </>
          }
        />
        {conflict && (
          <div className="banner" role="alert">
            다른 창에서 기록이 바뀌었어요. 최신 기록을 불러온 뒤 이어가 주세요.
          </div>
        )}
        {storageError && (
          <div className="banner" role="alert">{storageError}</div>
        )}
        <LegacyOnboarding
          progress={onboardingProgress}
          settings={settings}
          conflict={conflict}
          ready={onboardingReady}
          interpret={interpretOnboardingLine}
          onProgressChange={persistOnboarding}
          onComplete={completeFormalOnboarding}
          onRetryInitialization={() =>
            setOnboardingInitAttempt((attempt) => attempt + 1)
          }
        />
        {popup === "help" && (
          <Modal title="네 번의 첫걸음" onClose={() => setPopup(null)}>
            <p>
              각 장면에서 보이는 목표와 상황을 한 줄로 적고 Enter를 누르면,
              용사가 뜻을 읽어 바로 움직입니다.
            </p>
            <ul>
              <li>입력한 한 줄은 저장된 뒤 같은 장면에서 곧바로 실행돼요.</li>
              <li>실패해도 데스나 지우개를 쓰지 않고 같은 자리로 돌아와요.</li>
              <li>임시 한 줄은 연습 기록에만 남고 본편 메모로 복사되지 않아요.</li>
            </ul>
            <button className="primary wide" onClick={() => setPopup(null)}>
              알겠어요
            </button>
          </Modal>
        )}
        {popup === "settings" && (
          <Modal title="작은 모험의 설정" onClose={() => setPopup(null)}>
            <label>
              <input
                type="checkbox"
                checked={settings.muted}
                disabled={!onboardingReady || conflict}
                onChange={(event) =>
                  void changeSettings({
                    ...settings,
                    muted: event.target.checked,
                  })
                }
              />
              배경음악·효과음 끄기
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.reducedMotion}
                disabled={!onboardingReady || conflict}
                onChange={(event) =>
                  void changeSettings({
                    ...settings,
                    reducedMotion: event.target.checked,
                  })
                }
              />
              움직임과 장식 효과 줄이기
            </label>
          </Modal>
        )}
      </div>
    );
  }
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
          <PlayUtilityActions muted={settings.muted}
            onHelp={() => setPopup("help")}
            onToggleSound={() => { unlockAudio(); changeSettings({ ...settings, muted: !settings.muted }); }}
            onSettings={() => setPopup("settings")} />
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
      {archiveError && (
        <div className="banner" role="alert">
          {archiveError}{" "}
          <button
            className="secondary"
            onClick={() => void archiveCleared(stateRef.current)}
          >
            보관 다시 시도
          </button>{" "}
          <button className="secondary" onClick={exportSave}>
            기록 내보내기
          </button>
        </div>
      )}
      {!started && state.tutorial && <PrologueGuide />}
      <PlayLayout>
        <section className="game-panel" aria-label="던전 플레이">
          <div
            className={`scene-frame ${OBSERVATIONS[event?.observation ?? observation.id].sidePath && sceneMode !== "entrance" ? "has-side-path" : ""}`}
          >
            <div className="scene-head">
              <div>
                <span className="room-tag">
                  {state.tutorial
                    ? "PROLOGUE · 시작의 방"
                    : `첫 번째 여정 · STAGE 1-${Math.min(displayedRoom + 5, 12)}`}
                </span>
                <h2>{room.name}</h2>
              </div>
              {state.tutorial ? (
                <button
                  type="button"
                  className="subtle"
                  onClick={skipPrologue}
                  disabled={conflict}
                  aria-label="프롤로그 건너뛰기"
                  style={{ pointerEvents: "auto" }}
                >
                  SKIP
                </button>
              ) : (
                <span className="chapter-number">
                  {Math.min(displayedRoom + 5, 12)} / 12
                </span>
              )}
            </div>
            <div className="canvas-holder">
              <DungeonCanvas
                observation={observation}
                event={started ? event : null}
                phase={started ? state.phase : "title"}
                paused={paused || hidden || conflict}
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
                <div
                  className={`scene-caption ${sceneMode === "entrance" ? "returning" : ""} ${!animating && state.phase === "dead" ? "accident" : ""}`}
                  aria-live={animating ? "off" : "polite"}
                >
                  <span className="caption-kicker">
                    {sceneMode === "entrance"
                      ? "다시, 던전 입구에서"
                      : !animating
                        ? "방금 무슨 일이 있었냐면…"
                        : event?.instructionId
                          ? `기억한 말 · ${OBSERVATIONS[event?.observation ?? observation.id].label}`
                          : "메모가 없을 때는"}
                  </span>
                  <strong>
                    {sceneMode === "entrance"
                      ? "몸은 다시 태어나도, 메모는 꼭 챙겨 갈게."
                      : `“${activeMemory}”`}
                  </strong>
                  <span className="caption-action">
                    {sceneMode === "entrance"
                      ? "처음부터 다시 걸어가요"
                      : !animating
                        ? event?.reason
                        : ACTION_LABELS[event?.action ?? "advance"]}
                  </span>
                  {showDetourHint && (
                    <span className="route-hint">
                      옆길로 <b>우회</b>해 볼까?
                    </span>
                  )}
                </div>
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
            <div className="scene-foot">
              <span>
                <i />
                {!started
                  ? "한 줄에서 시작되는 모험"
                  : pending
                    ? "용사가 한 줄을 읽고 있어요"
                    : paused || hidden
                      ? "잠시 쉬어가는 중"
                      : animating && event?.repeated
                        ? "기억하는 길 · 3배속"
                        : actualPhase === "dead"
                          ? "넘어진 자리에도 기억은 남아"
                          : actualPhase === "cleared"
                            ? "던전 탈출 성공 · 모든 한 줄의 기억"
                            : "천천히, 한 걸음씩"}
              </span>
              {started && (animating || state.phase === "running") ? (
                <button
                  onClick={async () => {
                    if (awaitingNext) {
                      if (await playNext()) {
                        setAwaitingNext(false);
                        setPaused(false);
                      }
                    } else setPaused((x) => !x);
                  }}
                  aria-label={paused ? "다시 재생" : "일시정지"}
                >
                  {paused ? "▶ 다시 재생" : "Ⅱ 일시정지"}
                </button>
              ) : (
                <span>✦ {state.tutorial ? "연습 기록" : "기억의 던전"}</span>
              )}
            </div>
          </div>
          {started && (
            <div className="playback-tools">
              <label>
                <input
                  type="checkbox"
                  checked={sceneByScene}
                  onChange={async (e) => {
                    setSceneByScene(e.target.checked);
                    stepModeRef.current = e.target.checked;
                    if (!e.target.checked && awaitingNext) {
                      if (await playNext()) {
                        setAwaitingNext(false);
                        setPaused(false);
                      }
                    }
                  }}
                />
                한 장면씩 보기
              </label>
              {awaitingNext && (
                <button
                  className="secondary"
                  onClick={async () => {
                    if (await playNext()) {
                      setAwaitingNext(false);
                      setPaused(false);
                    }
                  }}
                >
                  다음 장면 →
                </button>
              )}
              {completedEvents.length > 0 && (
                <button
                  className="subtle"
                  onClick={() => {
                    setShowHistory(true);
                    setPaused(true);
                  }}
                >
                  방금 무슨 일이?
                </button>
              )}
            </div>
          )}
          {!started && !state.tutorial && (
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
          {state.tutorial ? (
            <div className="journey" aria-label="튜토리얼">
              {ROOMS.map((_, i) => (
                <span key={i} className={i === 0 ? "current" : ""} />
              ))}
            </div>
          ) : (
            <PlayStageProgress
              chapter={1}
              stages={[
                ...ONBOARDING_STAGES.map((stage) => ({
                  id: `intro:${stage.id}`,
                  title: stage.title,
                })),
                ...ROOMS.map((chapterRoom, index) => ({
                  id: `main:${index}`,
                  title: chapterRoom.name,
                })),
              ]}
              currentId={`main:${Math.min(displayedRoom, ROOMS.length - 1)}`}
              completedIds={[
                ...(onboardingProgress?.completedStageIds.map(
                  (id) => `intro:${id}`,
                ) ?? []),
                ...ROOMS.slice(0, displayedRoom).map(
                  (_, index) => `main:${index}`,
                ),
              ]}
            />
          )}
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
                label={
                  state.tutorial && state.instructions.length === 0
                    ? "첫 번째 가르침"
                    : "이번 생에서 남길 한 줄"
                }
                placeholder={
                  state.tutorial && state.instructions.length === 0
                    ? "앞으로 전진해"
                    : state.tutorial
                      ? "구덩이가 있으면 뛰어"
                      : "이럴 때는, 이렇게 해줘…"
                }
              />
              <PlayHints
                hints={legacyHints(room, observation)}
                resetKey={`${state.tutorial ? "prologue" : displayedRoom}:${observation.id}`}
              />
            </>
          )}
          {started &&
            isRest &&
            !(state.tutorial && state.instructions.length === 0) && (
              <div className="action-row">
                <button
                  className={state.canWrite ? "secondary" : "primary"}
                  onClick={launch}
                  disabled={
                    pending ||
                    conflict ||
                    (state.tutorial && state.instructions.length === 0)
                  }
                >
                  {state.phase === "dead"
                    ? state.canWrite
                      ? "한 줄 더 쓰지 않고 다시 출발"
                      : "입구에서 다시 출발"
                    : "모험 출발"}{" "}
                  <span>→</span>
                </button>
                {state.canWrite && state.phase === "dead" && (
                  <span className="helper">
                    지침 없이 출발하면 이번 작성 기회는 사라져요.
                  </span>
                )}
                {!state.canWrite && (
                  <span className="saved-mark">
                    ✓ 한 줄을 메모장에 기억했어요
                  </span>
                )}
              </div>
            )}
          {started && !animating && state.phase === "blocked" && (
            <button
              className="primary wide"
              onClick={async () => {
                await commit(abandon(stateRef.current));
              }}
              disabled={conflict}
            >
              포기하고 부활하기 · +1데스
            </button>
          )}
          {started && !animating && state.phase === "practice" && (
            <div className="composer">
              <label>지우개 연습 · {Math.min(practiceCount + 1, 3)} / 3</label>
              <p className="helper">
                연습 지우개 {Math.max(0, 2 - practiceCount)}개 · 연습 비용{" "}
                {practiceCount === 3 ? 3 : 0}데스
              </p>
              <p className="helper">
                {practiceCount < 2
                  ? "지우개가 있으면 한 줄당 하나를 사용해요."
                  : practiceCount === 2
                    ? "지우개가 없으면 한 줄당 3데스가 추가돼요. 새 작성 기회는 생기지 않아요."
                    : "잘했어요. 연습 비용은 모두 사라지고, 실제로 쓴 두 줄만 가져가요."}
              </p>
              {practiceCount < 3 ? (
                <>
                  <blockquote className="practice">
                    “
                    {["언제나 뛰어", "항상 숙여", "샛길로만 가"][practiceCount]}
                    ”
                    <p>
                      삭제 비용: {practiceCount < 2 ? "지우개 1개" : "3데스"} ·
                      본편에는 영향 없음
                    </p>
                    <button
                      className="secondary"
                      onClick={async () => {
                        if (
                          await commit(practiceDeletion(stateRef.current))
                        )
                          playSound("erase", settings.muted);
                      }}
                    >
                      이 연습 문장 지우기
                    </button>
                  </blockquote>
                  <p className="helper">
                    기본 전진은 지침을 지워도 계속됩니다.
                  </p>
                </>
              ) : (
                <button className="primary wide" onClick={enterMain}>
                  두 줄을 챙겨, 본편으로 <span>→</span>
                </button>
              )}
            </div>
          )}
          {started && !animating && state.phase === "cleared" && (
            <div className="composer">
              <span className="eyebrow">A SMALL HERO, A BIG ADVENTURE</span>
              <div className="win-score">
                {score(state)} <span style={{ fontSize: 18 }}>데스의 기억</span>
              </div>
              <p className="helper">
                사망·자진 부활 {state.deaths} + 삭제 패널티{" "}
                {state.penaltyDeaths} · 최고 기록 {best ?? score(state)}데스
              </p>
              <div className="action-row">
                <button className="primary" onClick={() => openChronicle(true)}>
                  우리의 모험 돌아보기
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setNotice("");
                    setPopup("share");
                  }}
                >
                  우리의 모험 공유하기 ↗
                </button>
                <button className="secondary" onClick={() => setPopup("new")}>
                  새로운 도전
                </button>
              </div>
            </div>
          )}
          {notice && (
            <p className="helper" role="status">
              {notice}
            </p>
          )}
          <div className="record-line">
            <span>
              <strong className="score">
                {state.tutorial ? "—" : displayedDeaths + state.penaltyDeaths}
              </strong>{" "}
              데스
            </span>
            <span>
              사망·부활{" "}
              <strong>{state.tutorial ? "연습" : displayedDeaths}</strong>
            </span>
            <span>
              삭제 패널티{" "}
              <strong>{state.tutorial ? "없음" : state.penaltyDeaths}</strong>
            </span>
            {best !== null && (
              <span>
                최고 <strong>{best}</strong>
              </span>
            )}
          </div>
        </section>
        <PlayNotebook
          count={state.instructions.length}
          className={reviving ? "remembering" : undefined}
          notebookRef={notebook}
        >
            <p className="memory-priority">상황이 맞으면 위쪽 메모부터 ↓</p>
            <span className="sr-only" role="status">
              {priorityNotice}
            </span>
            <ul
              className="instruction-list"
              aria-label="위쪽부터 우선 적용하는 메모. 손잡이 드래그 또는 메모 관리 메뉴로 순서를 바꿀 수 있어요"
            >
              {[...state.instructions].reverse().map((item, i) => (
                <li
                  key={item.id}
                  data-memory-id={item.id}
                  data-drop-position={
                    dropTarget?.id === item.id ? dropTarget.position : undefined
                  }
                  className={`instruction ${draggedMemory === item.id ? "dragging" : ""} ${erasing && deleteId === item.id ? "erasing" : ""} ${event?.instructionId === item.id && started ? "active" : ""}`}
                  onDragOver={(e) => {
                    if (dragRef.current && canReorder) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      targetMemoryDrag(e.clientX, e.clientY);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    targetMemoryDrag(e.clientX, e.clientY);
                    finishMemoryDrag(true);
                  }}
                >
                  <span
                    className={`memory-drag-handle ${canReorder ? "enabled" : ""}`}
                    draggable={canReorder}
                    title="드래그해서 우선순위 변경"
                    aria-hidden="true"
                    onDragStart={(e) => {
                      if (!startMemoryDrag(item.id)) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", item.id);
                    }}
                    onDragEnd={() => finishMemoryDrag(false)}
                    onPointerDown={(e) => {
                      if (
                        e.pointerType !== "mouse" &&
                        startMemoryDrag(item.id)
                      ) {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }
                    }}
                    onPointerMove={(e) => {
                      if (
                        e.pointerType !== "mouse" &&
                        e.currentTarget.hasPointerCapture(e.pointerId)
                      ) {
                        e.preventDefault();
                        targetMemoryDrag(e.clientX, e.clientY);
                      }
                    }}
                    onPointerUp={(e) => {
                      if (
                        e.pointerType !== "mouse" &&
                        e.currentTarget.hasPointerCapture(e.pointerId)
                      ) {
                        targetMemoryDrag(e.clientX, e.clientY);
                        finishMemoryDrag(true);
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                    }}
                    onPointerCancel={() => finishMemoryDrag(false)}
                  >
                    ⠿
                  </span>
                  <span className="line-text">
                    {item.text}
                    {event?.instructionId === item.id && started && (
                      <span className="memory-selected">
                        {animating ? "이번에 따르는 기억" : "방금 따른 기억"}
                      </span>
                    )}
                    <small>{ACTION_LABELS[item.interpretation.action]}</small>
                  </span>
                  <div className="memory-actions">
                    <button
                      type="button"
                      className="erase-button"
                      aria-label={`${item.text} 삭제`}
                      title="메모 삭제"
                      onClick={() => setDeleteId(item.id)}
                      disabled={
                        !started ||
                        state.phase !== "dead" ||
                        animating ||
                        state.tutorial ||
                        pending ||
                        conflict
                      }
                    >
                      ⌫
                    </button>
                    <button
                      type="button"
                      className="memory-menu-toggle"
                      aria-label={`${item.text} 메모 관리`}
                      aria-expanded={editingMemory === item.id}
                      aria-controls={`memory-tools-${item.id}`}
                      disabled={!canReorder || state.instructions.length < 2}
                      onClick={() =>
                        setEditingMemory((open) =>
                          open === item.id ? null : item.id,
                        )
                      }
                    >
                      ···
                    </button>
                  </div>
                  {editingMemory === item.id && started && isRest && (
                    <div
                      className="memory-tools"
                      id={`memory-tools-${item.id}`}
                      role="group"
                      aria-label={`${item.text} 메모 편집`}
                    >
                      {state.instructions.length > 1 && (
                        <div
                          className="priority-controls"
                          aria-label={`${item.text} 우선순위`}
                        >
                          <button
                            type="button"
                            aria-label={`${item.text} 우선순위 높이기`}
                            title="우선순위 높이기"
                            disabled={!canReorder || i === 0}
                            onClick={() => changePriority(item.id, "up")}
                          >
                            ↑ 위로
                          </button>
                          <button
                            type="button"
                            aria-label={`${item.text} 우선순위 낮추기`}
                            title="우선순위 낮추기"
                            disabled={
                              !canReorder || i === state.instructions.length - 1
                            }
                            onClick={() => changePriority(item.id, "down")}
                          >
                            ↓ 아래로
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {state.instructions.length === 0 && (
                <li className="empty-note">
                  아직 비어 있는 작은 메모장.
                  <br />첫 번째 기억을 남겨주세요.
                </li>
              )}
              {Array.from(
                { length: Math.max(0, 3 - state.instructions.length) },
                (_, i) => (
                  <li
                    className="empty-line"
                    key={`empty${i}`}
                    aria-hidden="true"
                  />
                ),
              )}
            </ul>
            <div className="paper-foot">
              <span>남은 지우개</span>
              <div className="erasers" aria-label={`지우개 ${state.erasers}개`}>
                {Array.from({ length: CONFIG.initialErasers }, (_, i) => i).map(
                  (i) => (
                    <span
                      key={i}
                      className={`eraser ${i >= state.erasers ? "spent" : ""}`}
                    />
                  ),
                )}
              </div>
            </div>
            <p className="paper-note">
              지우개를 다 쓰면, 한 줄을 지울 때 +{CONFIG.deletionPenalty}데스.
            </p>
            {onboardingProgress?.attempts.length ? (
              <details className="onboarding-history">
                <summary>
                  정식 도입 연습 기록 · {onboardingProgress.attempts.length}번
                </summary>
                <p>
                  아래 문장은 학습 기록이며, 본편에서 따르는 활성 메모와는
                  별개예요.
                </p>
                <ol>
                  {onboardingProgress.attempts.map((attempt) => (
                    <li key={attempt.sequence}>
                      <small>
                        1-
                        {ONBOARDING_STAGES.findIndex(
                          (stage) => stage.id === attempt.stageId,
                        ) + 1}
                      </small>{" "}
                      “{attempt.text}”
                      <span>
                        {attempt.applied
                          ? `${ACTION_LABELS[attempt.action]} · ${attempt.succeeded ? "목표 도달" : "무료 복구"}`
                          : "조건 불일치 · 실행 안 됨"}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : boot.data && !state.tutorial ? (
              <details className="onboarding-history">
                <summary>이전 진행 이어가기 · 정식 도입 면제</summary>
                <p>
                  기존 본편 기록을 그대로 이어가며, 플레이하지 않은 도입 완료
                  연혁은 만들지 않았어요.
                </p>
              </details>
            ) : null}
        </PlayNotebook>
      </PlayLayout>
      <footer className="footer">
        <span>
          {bridge
            ? "진행은 안전하게 자동 저장됩니다."
            : "이 브라우저에 자동 저장됩니다."}
        </span>
        <button
          className="subtle"
          onClick={() => openChronicle(state.phase === "cleared")}
        >
          지난 모험 기록
        </button>
      </footer>
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
                    {state.tutorial ? "연습" : `${e.room + 1}번째 문`} ·{" "}
                    {OBSERVATIONS[e.observation].label}
                  </small>
                  <blockquote>{e.instructionText ?? "기본 전진"}</blockquote>
                  <p>
                    {ACTION_LABELS[e.action]} → {e.reason}
                  </p>
                </li>
              ))}
          </ol>
        </Modal>
      )}
      {showChronicle && (
        <StageChronicle
          current={chronicleRecord}
          settings={settings}
          onClose={() => setShowChronicle(false)}
        />
      )}
      {popup === "help" && (
        <Modal title="한 줄씩, 함께 배우는 모험" onClose={() => setPopup(null)}>
          <p>
            용사는 기본적으로 앞으로 걸어요. 넘어진 이유를 보고, 다음 생에
            기억할 지침을 한 줄 남겨주세요.
          </p>
          <ul>
            <li>
              용사가 할 행동을 자연스럽게 적어요. 한 줄에는 한 가지 행동을, 여러
              조건에 같은 행동을 연결해도 좋아요.
            </li>
            <li>
              현재 상황에 맞는 메모 중 화면 위쪽 한 줄을 따라요. 출발 전에
              손잡이를 드래그하거나 ··· 메뉴의 ↑↓로 우선순위를 바꿀 수 있어요.
            </li>
            <li>
              사망 한 번당 새 지침은 최대 한 줄. 쓰지 않고 출발하면 기회는
              사라져요.
            </li>
            <li>
              같은 상황에 서로 다른 행동을 새로 기억할 수는 없어요. 조건을
              구체적으로 바꾸거나 기존 메모를 지워주세요.
            </li>
            <li>
              지우개 {CONFIG.initialErasers}개를 먼저 쓰고, 소진 후에는 삭제 한
              줄마다 {CONFIG.deletionPenalty}데스예요.
            </li>
            <li>
              전진 지침을 지워도 기본 전진은 계속돼요. 막히면 +1데스로 부활할 수
              있어요.
            </li>
            <li>이미 본 같은 행동은 3배속. 탭을 떠나면 자동으로 멈춰요.</li>
          </ul>
          <p>
            {bridge
              ? "진행은 여정 기록에 자동 저장됩니다."
              : "기록은 이 브라우저에만 저장됩니다. 다른 기기와 동기화되지 않아요."}
          </p>
          <button className="primary wide" onClick={() => setPopup(null)}>
            기억했어요
          </button>
        </Modal>
      )}
      {popup === "settings" && (
        <Modal title="작은 모험의 설정" onClose={() => setPopup(null)}>
          <label>
            <input
              type="checkbox"
              checked={settings.muted}
              onChange={(e) =>
                changeSettings({ ...settings, muted: e.target.checked })
              }
            />
            배경음악·효과음 끄기
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={(e) =>
                changeSettings({ ...settings, reducedMotion: e.target.checked })
              }
            />
            움직임과 장식 효과 줄이기
          </label>
          <p>자동 저장은 마지막으로 확정된 판단 지점을 기억해요.</p>
          <div className="action-row">
            <button className="secondary" onClick={exportSave}>
              기록 내보내기
            </button>
            <button className="secondary" onClick={() => setPopup("new")}>
              새 도전 시작
            </button>
          </div>
        </Modal>
      )}
      {popup === "new" && (
        <Modal title="새 메모장을 펼칠까요?" onClose={() => setPopup(null)}>
          <p>
            현재 지침과 데스 기록을 초기화하고 튜토리얼부터 시작해요. 개인 최고
            기록은 남고, 본편에서 지우개 {CONFIG.initialErasers}개를 다시
            받아요.
          </p>
          <div className="action-row">
            <button className="primary" onClick={newChallenge}>
              새 도전 시작
            </button>
            <button className="secondary" onClick={() => setPopup(null)}>
              계속할게요
            </button>
          </div>
        </Modal>
      )}
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
                  if (stateRef.current.phase === "running")
                    await playNext();
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
              <button className="secondary" onClick={archiveAndRestart}>
                원본 별도 보관 후 새 도전
              </button>
            )}
          </div>
        </Modal>
      )}
      {selected && (
        <Modal
          title="이 기억을 지울까요?"
          onClose={() => {
            if (!erasing) setDeleteId(null);
          }}
        >
          <blockquote>{selected.text}</blockquote>
          <p>
            비용:{" "}
            <strong>
              {state.erasers > 0
                ? "지우개 1개"
                : `${CONFIG.deletionPenalty}데스`}
            </strong>
            . 지운 기억은 되돌릴 수 없어요.
            {state.erasers === 0
              ? " 패널티로 새 작성 기회가 생기지는 않아요."
              : ""}
          </p>
          <div className="action-row">
            <button
              className="primary danger"
              onClick={erase}
              disabled={conflict || erasing}
            >
              비용을 사용하고 삭제
            </button>
            <button
              className="secondary"
              disabled={erasing}
              onClick={() => setDeleteId(null)}
            >
              취소
            </button>
          </div>
        </Modal>
      )}
      {popup === "share" && (
        <Modal title="우리의 모험을 남겨요" onClose={() => setPopup(null)}>
          <p>
            아래 내용 그대로 공유해요. 링크를 연 친구는 자신의 새 기록으로
            시작합니다.
          </p>
          <label>
            <input
              type="checkbox"
              checked={shareInstructions}
              onChange={(e) => setShareInstructions(e.target.checked)}
            />
            최종 메모장도 함께 공유
          </label>
          <pre>{shareText}</pre>
          <div className="action-row">
            <button className="primary" onClick={copyShare}>
              내용 복사
            </button>
            {typeof navigator.share === "function" && (
              <button
                className="secondary"
                onClick={() =>
                  navigator
                    .share({ title: "죽을 때마다 한 줄", text: shareText })
                    .catch(() => setNotice("공유를 취소했어요."))
                }
              >
                시스템 공유
              </button>
            )}
          </div>
          {notice && <p role="status">{notice}</p>}
        </Modal>
      )}
    </div>
  );
}
