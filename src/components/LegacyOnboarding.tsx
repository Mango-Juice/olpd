import { onboardingContactHint } from "../game/hints/chapter-one";
import { PlayContactHint } from "./PlayContactHint";
import { useEffect, useRef, useState } from "react";
import { ACTION_LABELS, CONFIG, ROOMS } from "../game/content";
import {
  ONBOARDING_STAGES,
  attemptOnboarding,
  chooseNarrative,
  isOnboardingComplete,
  type OnboardingAttemptResult,
  type OnboardingProgress,
} from "../game/onboarding";
import type { Interpretation, Settings } from "../game/types";
import { FLOOR_Y, idleHeroFrame } from "../render/animation";
import {
  LEGACY_EXIT_X,
  LEGACY_HERO_START_X,
  legacyDetourTrajectory,
  legacyDuckTrajectory,
  legacyGapFallTrajectory,
  legacyJumpTrajectory,
  legacyVisibleDetourPoint,
} from "../render/legacyOnboarding";
import { drawHero, onHeroSpriteReady, drawDungeonBackdrop, drawDungeonFloor, drawDungeonMasonry } from "../render/scene";
import {
  PlayHints,
  PlayLayout,
  PlayNotebook,
  PlayStageProgress,
} from "./PlayChrome";
import { PlayCommandComposer } from "./PlayCommandComposer";
import { usePlayCommand } from "../hooks/usePlayCommand";
import "./LegacyOnboarding.css";

interface LegacyOnboardingProps {
  progress: OnboardingProgress;
  settings: Settings;
  conflict: boolean;
  ready: boolean;
  interpret: (text: string, signal: AbortSignal) => Promise<Interpretation>;
  onProgressChange: (next: OnboardingProgress) => Promise<boolean>;
  onComplete: (completed: OnboardingProgress) => Promise<void>;
  onRetryInitialization: () => void;
}

interface Presentation {
  key: number;
  stageIndex: number;
  action: Interpretation["action"];
  applied: boolean;
  succeeded: boolean;
}

const STAGE_PROGRESS = [
  ...ONBOARDING_STAGES.map((stage) => ({
    id: `intro:${stage.id}`,
    title: stage.title,
  })),
  ...ROOMS.map((room, index) => ({ id: `main:${index}`, title: room.name })),
];

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(logicalWidth * pixelRatio);
  canvas.height = Math.round(logicalHeight * pixelRatio);
  const context = canvas.getContext("2d");
  context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return context;
}

function drawCanvasLabel(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  accent = false,
) {
  context.save();
  context.font = '600 16px "Noto Sans KR", sans-serif';
  const width = context.measureText(text).width + 24;
  context.fillStyle = accent ? "#d8ead0e8" : "#171a25dc";
  context.beginPath();
  context.roundRect(x, y, width, 32, 9);
  context.fill();
  context.fillStyle = accent ? "#273329" : "#eef0e8";
  context.textBaseline = "middle";
  context.fillText(text, x + 12, y + 16);
  context.restore();
}

function drawVisibleDetour(context: CanvasRenderingContext2D) {
  context.strokeStyle = "#b8d5bd";
  context.lineWidth = 8;
  context.lineCap = "round";
  context.beginPath();
  for (let step = 0; step <= 48; step++) {
    const point = legacyVisibleDetourPoint(step / 48);
    if (step === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
  context.lineCap = "butt";
  context.fillStyle = "#9fc3a044";
  for (const progress of [0, 1]) {
    const point = legacyVisibleDetourPoint(progress);
    context.beginPath();
    context.arc(point.x, point.y, 13, 0, Math.PI * 2);
    context.fill();
  }
  drawCanvasLabel(context, "샛길", 310, 320, true);
}

function drawStageObstacle(
  context: CanvasRenderingContext2D,
  stageIndex: number,
  groundY: number,
) {
  if (stageIndex === 1) {
    context.clearRect(440, groundY - 2, 112, 36);
    context.fillStyle = "#111423";
    context.fillRect(440, groundY, 112, 70);
    context.fillStyle = "#d9b88c";
    context.fillRect(454, 475, 84, 18);
    drawCanvasLabel(context, "바닥 틈", 454, 344);
  } else if (stageIndex === 2) {
    drawDungeonMasonry(context, 430, 235, 205, groundY - 235);
    context.save(); context.beginPath();
    context.moveTo(448, groundY); context.lineTo(448, 335);
    context.ellipse(533, 335, 85, 10, 0, Math.PI, Math.PI * 2);
    context.lineTo(618, groundY); context.closePath(); context.clip();
    drawDungeonBackdrop(context, 0, true);
    context.restore();
    context.strokeStyle = "#9289b4"; context.lineWidth = 6;
    context.beginPath(); context.moveTo(448, groundY); context.lineTo(448, 335);
    context.ellipse(533, 335, 85, 10, 0, Math.PI, Math.PI * 2);
    context.lineTo(618, groundY); context.stroke();
    drawCanvasLabel(context, "낮은 아치", 479, 278);
  } else if (stageIndex === 3) {
    drawDungeonMasonry(context, 430, 205, 155, groundY - 205);
    drawCanvasLabel(context, "막힌 벽", 458, 160);
  }
}

function OnboardingCanvas({
  stageIndex,
  presentation,
  reducedMotion,
}: {
  stageIndex: number;
  presentation: Presentation | null;
  reducedMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas, 960, 500);
    if (!context) return;
    let frame = 0;
    const startedAt = performance.now();
    const duration = reducedMotion ? 1 : 760;

    const draw = (now: number) => {
      const ratio = presentation
        ? Math.min(1, (now - startedAt) / duration)
        : 0;
      const width = 960;
      const height = 500;
      const groundY = FLOOR_Y;
      context.clearRect(0, 0, width, height);
      drawDungeonBackdrop(context, now / 1000, reducedMotion, width);
      drawDungeonFloor(context, 0, groundY, width);

      const doorX = 790;
      context.fillStyle = "#161a25";
      context.fillRect(doorX, 268, 86, groundY - 268);
      context.strokeStyle = "#b7cda7";
      context.lineWidth = 5;
      context.strokeRect(doorX, 268, 86, groundY - 268);
      context.fillStyle = "#b7cda733";
      context.fillRect(doorX + 8, 278, 70, groundY - 286);

      drawCanvasLabel(context, "출구", doorX + 13, 224, true);
      if (stageIndex === 3) drawVisibleDetour(context);

      let heroX = LEGACY_HERO_START_X;
      let heroY = FLOOR_Y;
      let pose = idleHeroFrame(now / 1000).pose;
      let heroScale = 1;
      let occludedByWall = false;
      if (presentation?.applied) {
        if (
          presentation.succeeded &&
          stageIndex === 1 &&
          presentation.action === "jump"
        ) {
          const point = legacyJumpTrajectory(ratio);
          ({ x: heroX, y: heroY, pose, scale: heroScale } = point);
        } else if (
          presentation.succeeded &&
          stageIndex === 2 &&
          presentation.action === "duck"
        ) {
          const point = legacyDuckTrajectory(ratio);
          ({ x: heroX, y: heroY, pose, scale: heroScale } = point);
        } else if (
          presentation.succeeded &&
          stageIndex === 3 &&
          presentation.action === "detour"
        ) {
          const point = legacyDetourTrajectory(ratio);
          ({
            x: heroX,
            y: heroY,
            pose,
            scale: heroScale,
            occludedByWall,
          } = point);
        } else if (
          !presentation.succeeded &&
          stageIndex === 1 &&
          presentation.action === "advance"
        ) {
          const point = legacyGapFallTrajectory(ratio);
          ({ x: heroX, y: heroY, pose, scale: heroScale } = point);
        } else if (presentation.action === "advance") {
          heroX +=
            ratio * (presentation.succeeded ? LEGACY_EXIT_X - heroX : 220);
          pose = "walk";
        } else if (presentation.action === "jump") {
          heroX +=
            ratio * (presentation.succeeded ? LEGACY_EXIT_X - heroX : 235);
          heroY -= Math.sin(ratio * Math.PI) * 115;
          pose = "jump";
        } else if (presentation.action === "duck") {
          heroX +=
            ratio * (presentation.succeeded ? LEGACY_EXIT_X - heroX : 180);
          pose = "duck";
        } else if (presentation.action === "detour") {
          heroX +=
            ratio * (presentation.succeeded ? LEGACY_EXIT_X - heroX : 150);
          pose = "detour";
        }
      }
      const heroFrame = {
        ...idleHeroFrame(now / 1000),
        x: heroX,
        y: heroY,
        pose,
        scale: heroScale,
        phase: ratio * 3,
        dust: presentation?.applied ? 0.35 : 0,
      };
      if (occludedByWall) drawHero(context, heroFrame, now / 1000);
      drawStageObstacle(context, stageIndex, groundY);
      if (!occludedByWall) drawHero(context, heroFrame, now / 1000);

      if (presentation && ratio < 1) {
        frame = requestAnimationFrame(draw);
      }
    };

    frame = requestAnimationFrame(draw);
    const stopWatchingSprite = onHeroSpriteReady(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    return () => { stopWatchingSprite(); cancelAnimationFrame(frame); };
  }, [presentation, reducedMotion, stageIndex]);

  return (
    <canvas
      ref={canvasRef}
      width={960}
      height={500}
      role="img"
      aria-label={`${ONBOARDING_STAGES[stageIndex].title}: ${ONBOARDING_STAGES[stageIndex].goal}`}
    />
  );
}

function StoryHeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas ? prepareCanvas(canvas, 180, 220) : null;
    if (!canvas || !context) return;
    let frame = 0;
    const draw = (now: number) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawHero(
        context,
        {
          ...idleHeroFrame(now / 1000),
          x: 90,
          y: 196,
          shadow: 0,
        },
        now / 1000,
      );
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="legacy-story-hero-canvas"
      width={180}
      height={220}
      aria-hidden="true"
    />
  );
}

export function LegacyOnboarding({
  progress,
  settings,
  conflict,
  ready,
  interpret,
  onProgressChange,
  onComplete,
  onRetryInitialization,
}: LegacyOnboardingProps) {
  const [draft, setDraft] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [lastInterpretation, setLastInterpretation] = useState<{
    text: string;
    value: Interpretation;
  } | null>(null);
  const presentationKey = useRef(0);
  const mounted = useRef(true);

  useEffect(
    () => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    },
    [],
  );

  const chooseStory = async (choice: "read" | "skipped") => {
    if (pending || conflict || !ready) return;
    setActionPending(true);
    setActionError("");
    const saved = await onProgressChange(chooseNarrative(progress, choice));
    if (!mounted.current) return;
    if (!saved) setActionError("이야기 선택을 저장하지 못했어요. 다시 시도해 주세요.");
    setActionPending(false);
  };

  const finishAttempt = async (result: OnboardingAttemptResult) => {
    const stageIndex = progress.currentStage;
    if (!(await onProgressChange(result.progress))) return false;
    if (!mounted.current) return false;
    setPresentation({
      key: ++presentationKey.current,
      stageIndex,
      action: result.attempt.action,
      applied: result.attempt.applied,
      succeeded: result.attempt.succeeded,
    });
    setMessage(result.message);
    await wait(settings.reducedMotion ? 30 : 820);
    if (!mounted.current) return false;
    if (result.attempt.succeeded) {
      setDraft("");
      setLastInterpretation(null);
      setPresentation(null);
      if (isOnboardingComplete(result.progress)) {
        await onComplete(result.progress);
      } else {
        setMessage("다음 장면은 새 시작점과 빈 임시 한 줄로 시작해요.");
      }
    }
    return true;
  };

  const {
    pending: commandPending,
    error: commandError,
    submit,
    cancel,
    clearError,
  } = usePlayCommand<Interpretation>({
    contextKey: `${progress.ownerRunId}:${progress.currentStage}:${progress.attempts.length}`,
    maxLength: CONFIG.maxInstructionLength,
    timeoutMs: CONFIG.requestTimeoutMs,
    blocked: conflict || !ready || executing,
    interpret,
    execute: async (value, text) => {
      setExecuting(true);
      setMessage("");
      setLastInterpretation({ text, value });
      try {
        return await finishAttempt(attemptOnboarding(progress, text, value));
      } finally {
        if (mounted.current) setExecuting(false);
      }
    },
    onStart: () => setActionError(""),
  });
  const pending = actionPending || commandPending || executing;
  const error = commandError || actionError;

  const repeat = async () => {
    if (!lastInterpretation || pending || conflict || !ready) return;
    setActionPending(true);
    setActionError("");
    try {
      const saved = await finishAttempt(
        attemptOnboarding(
          progress,
          lastInterpretation.text,
          lastInterpretation.value,
        ),
      );
      if (!saved) setActionError("도입 기록을 저장하지 못했어요. 같은 장면에서 다시 시도해 주세요.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "다시 실행하지 못했어요.");
    } finally {
      if (mounted.current) setActionPending(false);
    }
  };

  if (progress.narrative === "unseen") {
    return (
      <section className="legacy-story" aria-labelledby="legacy-story-title">
        <div className="legacy-story-scene" aria-hidden="true">
          <span className="legacy-story-moon">◔</span>
          <StoryHeroCanvas />
          <span className="legacy-story-door" />
        </div>
        <div className="legacy-story-copy">
          <span className="eyebrow">PROLOGUE · 오래된 편지</span>
          <h2 id="legacy-story-title">한 줄이 작은 용사의 길이 됩니다.</h2>
          <p>
            달빛이 닿지 않는 던전 깊은 곳, 용사는 오래된 편지를 품고 문 앞에
            섰습니다. 당신이 남긴 한 줄만이 다음 걸음을 알려 줍니다.
          </p>
          <p>
            이야기는 건너뛸 수 있어도 몸으로 익힐 네 번의 첫걸음은 모험의 일부예요.
          </p>
          {!ready && (
            <p role="status">첫 장면을 안전하게 보관하고 있어요…</p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="action-row">
            <button
              type="button"
              className="primary"
              disabled={!ready || pending || conflict}
              onClick={() => void chooseStory("read")}
            >
              첫 문을 향해 <span>→</span>
            </button>
            <button
              type="button"
              className="subtle"
              disabled={!ready || pending || conflict}
              onClick={() => void chooseStory("skipped")}
            >
              이야기 SKIP
            </button>
            {!ready && (
              <button
                type="button"
                className="secondary"
                disabled={pending || conflict}
                onClick={onRetryInitialization}
              >
                저장 다시 시도
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (isOnboardingComplete(progress) && !executing) {
    return (
      <section className="legacy-story" aria-labelledby="legacy-handoff-title">
        <div className="legacy-story-scene" aria-hidden="true">
          <span className="legacy-story-moon">◔</span>
          <StoryHeroCanvas />
          <span className="legacy-story-door" />
        </div>
        <div className="legacy-story-copy">
          <span className="eyebrow">1-4 COMPLETE</span>
          <h2 id="legacy-handoff-title">네 번의 첫걸음을 모두 마쳤어요.</h2>
          <p>
            연습한 문장은 기록으로만 남겨 두고, 본편은 빈 메모장과 무료 첫 작성
            한 번, 지우개 두 개로 시작합니다.
          </p>
          <button
            type="button"
            className="primary"
            disabled={pending || conflict}
            onClick={() => void onComplete(progress)}
          >
            1-5 첫 번째 기억으로 <span>→</span>
          </button>
        </div>
      </section>
    );
  }

  const stageIndex = presentation?.stageIndex ?? Math.min(
    progress.currentStage,
    ONBOARDING_STAGES.length - 1,
  );
  const stage = ONBOARDING_STAGES[stageIndex];
  const stageAttempts = progress.attempts.filter(
    (attempt) => attempt.stageId === stage.id,
  );

  return (
    <>
      <PlayLayout>
        <section className="game-panel legacy-onboarding" aria-label="1장 정식 도입">
          <div className="scene-frame">
            <div className="scene-head">
              <div>
                <span className="room-tag">정식 도입 · 1-{stageIndex + 1}</span>
                <h2>{stage.title}</h2>
              </div>
              <span className="chapter-number">{stageIndex + 1} / 12</span>
            </div>
            <div className="canvas-holder legacy-onboarding-canvas">
              <OnboardingCanvas
                stageIndex={stageIndex}
                presentation={presentation}
                reducedMotion={settings.reducedMotion}
              />
            </div>
            {presentation && (
              <div className="scene-caption" aria-live="polite">
                <span className="caption-kicker">임시 한 줄을 따라</span>
                <strong>“{lastInterpretation?.text ?? draft.trim()}”</strong>
                <span className="caption-action">
                  {ACTION_LABELS[presentation.action]}
                </span>
                <PlayContactHint text={!executing && presentation.applied && !presentation.succeeded ? onboardingContactHint(progress) : null} />
              </div>
            )}
            <div className="scene-foot">
              <span><i /> {stage.goal}</span>
              <span>무료 지역 복구</span>
            </div>
          </div>
          <PlayStageProgress
            chapter={1}
            stages={STAGE_PROGRESS}
            currentId={`intro:${stage.id}`}
            completedIds={progress.completedStageIds.map((id) => `intro:${id}`)}
          />
          <PlayCommandComposer
            id="onboarding-instruction"
            value={draft}
            onChange={(value) => {
              setDraft(value);
              setLastInterpretation(null);
              clearError();
              setActionError("");
            }}
            onSubmit={submit}
            onCancel={cancel}
            pending={commandPending}
            error={error}
            disabled={actionPending || executing || conflict || !ready}
            maxLength={CONFIG.maxInstructionLength}
            label="이 장면에서만 쓸 임시 한 줄"
            placeholder="보이는 장면과 용사가 할 행동을 한 줄로 적어 주세요."
          >
            {message && <p className="legacy-onboarding-result" role="status">{message}</p>}
            <div className="legacy-onboarding-tools">
              <button
                type="button"
                className="subtle"
                disabled={pending || !draft}
                onClick={() => {
                  cancel();
                  setDraft("");
                  setLastInterpretation(null);
                  setPresentation(null);
                  clearError();
                  setActionError("");
                  setMessage("임시 한 줄을 지웠어요. 비용 없이 다시 쓸 수 있어요.");
                }}
              >
                임시 한 줄 지우기
              </button>
              <button
                type="button"
                className="subtle"
                disabled={pending}
                onClick={() => {
                  setPresentation(null);
                  setMessage("이 장면의 시작점으로 돌아왔어요.");
                }}
              >
                장면 처음부터
              </button>
              {lastInterpretation && (
                <button type="button" className="subtle" disabled={pending} onClick={() => void repeat()}>
                  같은 한 줄 다시 실행
                </button>
              )}
            </div>
          </PlayCommandComposer>
          <PlayHints hints={stage.hint} resetKey={stage.id} />
        </section>
        <PlayNotebook count={stageAttempts.length}>
          <p className="paper-note">
            이 장면의 문장은 연습 기록에만 남고 본편 메모로 넘어가지 않아요.
          </p>
          {stageAttempts.length ? (
            <ol className="legacy-attempt-list">
              {stageAttempts.map((attempt) => (
                <li key={attempt.sequence}>
                  <span aria-hidden="true">{attempt.succeeded ? "✓" : "↻"}</span>
                  <span>“{attempt.text}”</span>
                  <small>
                    {attempt.applied
                      ? ACTION_LABELS[attempt.action]
                      : "조건 불일치 · 실행 안 됨"}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-memory">아직 실행한 임시 한 줄이 없어요.</p>
          )}
        </PlayNotebook>
      </PlayLayout>
    </>
  );
}
