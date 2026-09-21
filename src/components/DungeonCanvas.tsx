import { useEffect, useRef } from "react";
import { ACTION_LABELS, OBSERVATIONS } from "../game/content";
import type { ExecutionEvent, Observation, Phase } from "../game/types";
import {
  eventDuration,
  eventHeroFrame,
  idleHeroFrame,
  reviveHeroFrame,
  soundCuesBetween,
  type HeroFrame,
  type SoundCue,
} from "../render/animation";
import { renderScene, VIEW_HEIGHT, VIEW_WIDTH } from "../render/scene";

interface DungeonCanvasProps {
  observation: Observation;
  event: ExecutionEvent | null;
  phase: Phase;
  paused: boolean;
  reducedMotion: boolean;
  onPlaybackEnd: () => void;
  onFrameStats?: (fps: number) => void;
  onSound?: (cue: SoundCue) => void;
  onSceneModeChange?: (mode: "entrance" | "action") => void;
  roomName?: string;
}

type Playback =
  | { kind: "idle"; elapsed: number; hero: HeroFrame | null }
  | {
      kind: "event";
      id: string;
      elapsed: number;
      duration: number;
      ended: boolean;
      cueProgress: number;
      hero: HeroFrame | null;
    }
  | {
      kind: "transition";
      elapsed: number;
      duration: number;
      from: HeroFrame;
      fromObservation: Observation;
      next: ExecutionEvent;
      hero: HeroFrame | null;
    }
  | {
      kind: "revive";
      elapsed: number;
      duration: number;
      next: ExecutionEvent | null;
      cuePlayed: boolean;
      hero: HeroFrame | null;
    };

export function DungeonCanvas(props: DungeonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<DungeonCanvasProps>(props);
  const playbackRef = useRef<Playback>({
    kind: "idle",
    elapsed: 0,
    hero: null,
  });
  const lastEventIdRef = useRef<string | null>(null);
  const lastPresentedEventRef = useRef<ExecutionEvent | null>(null);
  const revivedEventIdRef = useRef<string | null>(null);
  const previousPhaseRef = useRef<Phase>(props.phase);
  const hiddenRef = useRef(
    typeof document !== "undefined" ? document.hidden : false,
  );

  liveRef.current = props;

  useEffect(() => {
    const event = props.event;
    const previousPhase = previousPhaseRef.current;
    const playback = playbackRef.current;
    const becameReadyAfterFatal =
      props.phase === "ready" &&
      (previousPhase === "dead" || previousPhase === "blocked") &&
      event !== null &&
      (event.outcome === "death" || event.outcome === "blocked");

    if (event && event.id !== lastEventIdRef.current) {
      const previousEvent = lastPresentedEventRef.current;
      const from = playback.hero;
      lastEventIdRef.current = event.id;
      lastPresentedEventRef.current = event;
      const previousWasFatal =
        previousEvent?.outcome === "death" ||
        previousEvent?.outcome === "blocked";
      if (
        previousEvent &&
        from &&
        revivedEventIdRef.current !== previousEvent.id &&
        previousWasFatal
      ) {
        revivedEventIdRef.current = previousEvent.id;
        props.onSceneModeChange?.("entrance");
        playbackRef.current = {
          kind: "revive",
          elapsed: 0,
          duration: props.reducedMotion ? 1050 : 1650,
          next: event,
          cuePlayed: false,
          hero: from,
        };
      } else if (previousEvent && from && !previousWasFatal) {
        props.onSceneModeChange?.("action");
        playbackRef.current = {
          kind: "transition",
          elapsed: 0,
          duration: props.reducedMotion ? 140 : 280,
          from,
          fromObservation: OBSERVATIONS[previousEvent.observation],
          next: event,
          hero: from,
        };
      } else {
        props.onSceneModeChange?.("action");
        playbackRef.current = {
          kind: "event",
          id: event.id,
          elapsed: 0,
          duration: eventDuration(event),
          ended: false,
          cueProgress: 0,
          hero: null,
        };
      }
    } else if (becameReadyAfterFatal && event) {
      const from = playback.hero ?? eventHeroFrame(event, 1, false);
      revivedEventIdRef.current = event.id;
      props.onSceneModeChange?.("entrance");
      playbackRef.current = {
        kind: "revive",
        elapsed: 0,
        duration: props.reducedMotion ? 1050 : 1650,
        next: null,
        cuePlayed: false,
        hero: from,
      };
    } else if (
      props.phase === "title" ||
      (props.phase === "ready" && playback.kind !== "revive")
    ) {
      playbackRef.current = { kind: "idle", elapsed: 0, hero: null };
      if (!event) {
        lastEventIdRef.current = null;
        lastPresentedEventRef.current = null;
        revivedEventIdRef.current = null;
      }
    }
    previousPhaseRef.current = props.phase;
  }, [props.event, props.phase, props.reducedMotion]);

  useEffect(() => {
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let raf = 0;
    let previousTime = performance.now();
    let fpsStarted = previousTime;
    let fpsFrames = 0;
    let sceneElapsed = 0;
    let lowFpsDuration = 0;
    let reducedDecoration = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (now: number) => {
      const current = liveRef.current;
      const delta = Math.min(50, Math.max(0, now - previousTime));
      previousTime = now;
      const paused = current.paused || hiddenRef.current;
      const playback = playbackRef.current;
      if (!paused) {
        playback.elapsed += delta;
        sceneElapsed += delta;
      }
      const sceneTime = sceneElapsed / 1000;

      let hero: HeroFrame;
      let sceneObservation = current.observation;
      let transitionShade = 0;
      if (playback.kind === "event" && current.event?.id === playback.id) {
        const progress = Math.min(1, playback.elapsed / playback.duration);
        if (!paused && progress > playback.cueProgress) {
          for (const cue of soundCuesBetween(
            current.event,
            playback.cueProgress,
            progress,
            current.phase === "cleared",
          )) {
            current.onSound?.(cue);
          }
          playback.cueProgress = progress;
        }
        hero = eventHeroFrame(
          current.event,
          progress,
          current.phase === "cleared",
        );
        sceneObservation = OBSERVATIONS[current.event.observation];
        playback.hero = hero;
        if (progress >= 1 && !playback.ended) {
          playback.ended = true;
          // Core state is already committed; this only reports presentation completion.
          queueMicrotask(() => liveRef.current.onPlaybackEnd());
        }
      } else if (playback.kind === "transition") {
        const progress = Math.min(1, playback.elapsed / playback.duration);
        if (progress < 0.5) {
          const part = progress * 2;
          hero = {
            ...playback.from,
            x: playback.from.x + (VIEW_WIDTH + 55 - playback.from.x) * part,
            opacity: 1 - part * 0.7,
            pose: "walk",
            phase: part * 2,
          };
          sceneObservation = playback.fromObservation;
        } else {
          const part = (progress - 0.5) * 2;
          hero = {
            ...idleHeroFrame(sceneTime),
            x: -45 + 197 * part,
            opacity: 0.3 + part * 0.7,
            pose: "walk",
            phase: part * 2,
          };
          sceneObservation = OBSERVATIONS[playback.next.observation];
        }
        transitionShade = 1 - Math.abs(progress * 2 - 1);
        playback.hero = hero;
        if (progress >= 1) {
          playbackRef.current = {
            kind: "event",
            id: playback.next.id,
            elapsed: 0,
            duration: eventDuration(playback.next),
            ended: false,
            cueProgress: 0,
            hero,
          };
        }
      } else if (playback.kind === "revive") {
        const progress = Math.min(1, playback.elapsed / playback.duration);
        if (!paused && progress > 0 && !playback.cuePlayed) {
          playback.cuePlayed = true;
          current.onSound?.("revive");
        }
        hero = reviveHeroFrame(progress);
        // Retry is a true return to the entrance: the fatal hazard disappears
        // before Moru is summoned, so no corpse or ghost travels across it.
        sceneObservation = OBSERVATIONS.clear;
        playback.hero = hero;
        if (progress >= 1) {
          if (playback.next) {
            queueMicrotask(() =>
              liveRef.current.onSceneModeChange?.("action"),
            );
          }
          playbackRef.current = playback.next
            ? {
                kind: "event",
                id: playback.next.id,
                elapsed: 0,
                duration: eventDuration(playback.next),
                ended: false,
                cueProgress: 0,
                hero,
              }
            : { kind: "idle", elapsed: 0, hero };
        }
      } else {
        hero = idleHeroFrame(sceneTime);
        playback.hero = hero;
      }

      const uniformScale = Math.min(
        canvas.width / VIEW_WIDTH,
        canvas.height / VIEW_HEIGHT,
      );
      const sceneWidth = VIEW_WIDTH * uniformScale;
      const sceneHeight = VIEW_HEIGHT * uniformScale;
      const offsetX = Math.max(0, (canvas.width - sceneWidth) / 2);
      const offsetY = Math.max(0, canvas.height - sceneHeight);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#090b1d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.setTransform(
        uniformScale,
        0,
        0,
        uniformScale,
        offsetX,
        offsetY,
      );
      renderScene(context, {
        time: sceneTime,
        hero,
        observation: sceneObservation,
        phase: current.phase,
        reducedMotion: current.reducedMotion || reducedDecoration,
      });
      if (transitionShade > 0) {
        context.fillStyle = `rgba(7, 8, 24, ${transitionShade * 0.72})`;
        context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      }

      if (!paused) {
        fpsFrames += 1;
        if (now - fpsStarted >= 1000) {
          const sampleDuration = now - fpsStarted;
          const fps = Math.round((fpsFrames * 1000) / sampleDuration);
          current.onFrameStats?.(fps);
          if (fps < 45) {
            lowFpsDuration += sampleDuration;
            if (lowFpsDuration >= 2000) reducedDecoration = true;
          } else {
            lowFpsDuration = 0;
          }
          fpsStarted = now;
          fpsFrames = 0;
        }
      } else {
        fpsStarted = now;
        fpsFrames = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const activeObservation = props.event
    ? OBSERVATIONS[props.event.observation]
    : props.observation;
  const stateLabel =
    props.event && props.phase !== "title" && props.phase !== "ready"
      ? `${activeObservation.label}, ${ACTION_LABELS[props.event.action]} 행동, ${props.event.outcome === "safe" ? "통과" : props.event.outcome === "death" ? "사망" : "막힘"}`
      : `${activeObservation.label}, 용사가 입구에서 기다리는 중`;

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${props.roomName ? `${props.roomName}. ` : ""}${stateLabel}`}
      width={VIEW_WIDTH}
      height={VIEW_HEIGHT}
      style={{
        display: "block",
        width: "100%",
        aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}`,
        objectFit: "contain",
        borderRadius: "18px",
        background: "#090b1d",
        boxShadow:
          "0 24px 70px rgba(4, 5, 18, .42), inset 0 0 0 1px rgba(184, 220, 222, .12)",
      }}
    />
  );
}

export default DungeonCanvas;
