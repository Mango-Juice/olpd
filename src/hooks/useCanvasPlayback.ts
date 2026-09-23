import { useEffect, useRef, type RefObject } from "react";

export interface CanvasPlaybackFrame {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  now: number;
  /** Zero while presentation is paused or the document is hidden. */
  deltaMs: number;
  sceneTime: number;
  paused: boolean;
  reducedMotion: boolean;
}

interface CanvasPlaybackOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  paused: boolean;
  reducedMotion: boolean;
  draw: (frame: CanvasPlaybackFrame) => void;
  onFrameStats?: (fps: number) => void;
}

/**
 * One animation clock for every dungeon canvas.
 *
 * It owns DPR resizing, visibility/pause freezing, ambient scene time and the
 * low-FPS decoration fallback. Gameplay timelines remain deterministic and
 * advance only by the `deltaMs` supplied here.
 */
export function useCanvasPlayback(options: CanvasPlaybackOptions): void {
  const live = useRef(options);
  live.current = options;

  useEffect(() => {
    const canvas = live.current.canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let raf = 0;
    let previousTime = performance.now();
    let sceneElapsed = 0;
    let hidden = document.hidden;
    let fpsStarted = previousTime;
    let fpsFrames = 0;
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

    const onVisibility = () => {
      hidden = document.hidden;
      // Never count time spent outside the tab when the next RAF arrives.
      previousTime = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const draw = (now: number) => {
      const current = live.current;
      const paused = current.paused || hidden;
      const rawDelta = Math.min(50, Math.max(0, now - previousTime));
      previousTime = now;
      const deltaMs = paused ? 0 : rawDelta;
      if (!paused) sceneElapsed += deltaMs;

      current.draw({
        canvas,
        context,
        now,
        deltaMs,
        sceneTime: sceneElapsed / 1000,
        paused,
        reducedMotion: current.reducedMotion || reducedDecoration,
      });

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
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

export interface PlaybackTimeline {
  elapsed: number;
  duration: number;
  cueProgress: number;
  ended: boolean;
}

interface AdvanceTimelineOptions<TCue> {
  deltaMs: number;
  cuesBetween?: (from: number, to: number) => readonly TCue[];
  onCue?: (cue: TCue) => void;
  onEnd?: () => void;
}

/** Advances one persisted presentation and dispatches cues/completion once. */
export function advancePlaybackTimeline<TCue>(
  timeline: PlaybackTimeline,
  options: AdvanceTimelineOptions<TCue>,
): number {
  if (!timeline.ended && options.deltaMs > 0) timeline.elapsed += options.deltaMs;
  const progress = Math.min(1, timeline.elapsed / Math.max(1, timeline.duration));
  if (progress > timeline.cueProgress) {
    for (const cue of options.cuesBetween?.(timeline.cueProgress, progress) ?? []) {
      options.onCue?.(cue);
    }
    timeline.cueProgress = progress;
  }
  if (progress >= 1 && !timeline.ended) {
    timeline.ended = true;
    queueMicrotask(() => options.onEnd?.());
  }
  return progress;
}
