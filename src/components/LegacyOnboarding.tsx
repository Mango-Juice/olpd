import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
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
import { drawHero } from "../render/scene";
import {
  PlayComposer,
  PlayHints,
  PlayLayout,
  PlayNotebook,
  PlayStageProgress,
} from "./PlayChrome";
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

function conditionLabels(interpretation: Interpretation): string[] {
  const labels = interpretation.appliesTo.map((id) => {
    if (id === "clear") return "평평한 길";
    if (id === "pit" || id === "bridge") return "바닥이 끊긴 곳";
    if (id === "lowCeiling") return "머리 위가 낮은 곳";
    return "옆길이 있는 곳";
  });
  return [...new Set(labels)];
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
    const context = canvas.getContext("2d");
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
      const groundY = FLOOR_Y + 18;
      context.clearRect(0, 0, width, height);
      const background = context.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "#171a2c");
      background.addColorStop(1, "#27283b");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      context.fillStyle = "#302f43";
      for (let x = 0; x < width; x += 120) {
        context.fillRect(x + 3, 80 + ((x / 120) % 2) * 16, 96, 8);
      }
      context.fillStyle = "#4a4654";
      context.fillRect(0, groundY, width, 128);
      context.fillStyle = "#675e62";
      context.fillRect(0, groundY, width, 8);

      const doorX = 790;
      context.fillStyle = "#161a25";
      context.fillRect(doorX, 268, 86, groundY - 268);
      context.strokeStyle = "#b7cda7";
      context.lineWidth = 5;
      context.strokeRect(doorX, 268, 86, groundY - 268);
      context.fillStyle = "#b7cda733";
      context.fillRect(doorX + 8, 278, 70, groundY - 286);

      if (stageIndex === 1) {
        context.clearRect(440, groundY - 2, 112, 36);
        context.fillStyle = "#111423";
        context.fillRect(440, groundY, 112, 70);
        context.fillStyle = "#d9b88c";
        context.fillRect(454, 475, 84, 18);
      } else if (stageIndex === 2) {
        context.fillStyle = "#504b57";
        context.fillRect(430, 235, 205, 132);
        context.fillStyle = "#171a2c";
        context.fillRect(448, 325, 170, 95);
        context.strokeStyle = "#746d76";
        context.lineWidth = 8;
        context.beginPath();
        context.arc(533, 324, 85, Math.PI, 0);
        context.stroke();
      } else if (stageIndex === 3) {
        context.fillStyle = "#55505d";
        context.fillRect(430, 205, 155, 215);
        context.strokeStyle = "#b8d5bd";
        context.lineWidth = 8;
        context.beginPath();
        context.moveTo(330, 400);
        context.bezierCurveTo(360, 345, 360, 250, 442, 245);
        context.bezierCurveTo(555, 238, 642, 330, 742, 400);
        context.stroke();
        context.fillStyle = "#9fc3a044";
        context.beginPath();
        context.arc(330, 400, 13, 0, Math.PI * 2);
        context.arc(742, 400, 13, 0, Math.PI * 2);
        context.fill();
      }

      let heroX = 166;
      let heroY = FLOOR_Y;
      let pose = idleHeroFrame(now / 1000).pose;
      if (presentation?.applied) {
        if (presentation.action === "advance") {
          heroX += ratio * (presentation.succeeded ? 590 : stageIndex === 1 ? 260 : 220);
          pose = "walk";
        } else if (presentation.action === "jump") {
          heroX += ratio * (presentation.succeeded ? 590 : 235);
          heroY -= Math.sin(ratio * Math.PI) * 115;
          pose = "jump";
        } else if (presentation.action === "duck") {
          heroX += ratio * (presentation.succeeded ? 590 : 180);
          pose = "duck";
        } else if (presentation.action === "detour") {
          heroX += ratio * (presentation.succeeded ? 590 : 150);
          heroY -=
            stageIndex === 3 && presentation.succeeded
              ? Math.sin(ratio * Math.PI) * 145
              : 0;
          pose = "detour";
        }
      }
      drawHero(
        context,
        {
          ...idleHeroFrame(now / 1000),
          x: heroX,
          y: heroY,
          pose,
          phase: ratio * 3,
          dust: presentation?.applied ? 0.35 : 0,
        },
        now / 1000,
      );

      if (presentation && ratio < 1) {
        frame = requestAnimationFrame(draw);
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
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
    const context = canvas?.getContext("2d");
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [candidate, setCandidate] = useState<{
    text: string;
    value: Interpretation;
  } | null>(null);
  const [lastInterpretation, setLastInterpretation] = useState<{
    text: string;
    value: Interpretation;
  } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const presentationKey = useRef(0);
  const composing = useRef(false);
  const mounted = useRef(true);

  useEffect(
    () => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        requestRef.current?.abort();
      };
    },
    [],
  );

  const chooseStory = async (choice: "read" | "skipped") => {
    if (pending || conflict || !ready) return;
    setPending(true);
    setError("");
    const saved = await onProgressChange(chooseNarrative(progress, choice));
    if (!mounted.current) return;
    if (!saved) setError("이야기 선택을 저장하지 못했어요. 다시 시도해 주세요.");
    setPending(false);
  };

  const finishAttempt = async (result: OnboardingAttemptResult) => {
    const stageIndex = progress.currentStage;
    setPresentation({
      key: ++presentationKey.current,
      stageIndex,
      action: result.attempt.action,
      applied: result.attempt.applied,
      succeeded: result.attempt.succeeded,
    });
    setMessage(result.message);
    await wait(settings.reducedMotion ? 30 : 820);
    if (!mounted.current) return;
    if (!(await onProgressChange(result.progress))) {
      if (!mounted.current) return;
      setError("도입 기록을 저장하지 못했어요. 같은 장면에서 다시 시도해 주세요.");
      return;
    }
    if (!mounted.current) return;
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
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || conflict || !ready || composing.current) return;
    const text = draft.trim();
    if (!text) {
      setError("용사에게 남길 한 줄을 적어 주세요.");
      return;
    }
    if ([...text].length > CONFIG.maxInstructionLength) {
      setError(`한 줄은 ${CONFIG.maxInstructionLength}자까지 쓸 수 있어요.`);
      return;
    }
    setPending(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      CONFIG.requestTimeoutMs,
    );
    try {
      const value = await interpret(text, controller.signal);
      setCandidate({ text, value });
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? "15초 안에 응답이 오지 않았어요. 쓴 문장은 그대로예요."
          : cause instanceof Error
          ? cause.message
          : "뜻을 확인하지 못했어요. 쓴 문장은 그대로예요.",
      );
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
      if (mounted.current) setPending(false);
    }
  };

  const confirmCandidate = async () => {
    if (!candidate || pending || conflict || !ready) return;
    setPending(true);
    setError("");
    setLastInterpretation(candidate);
    try {
      await finishAttempt(
        attemptOnboarding(progress, candidate.text, candidate.value),
      );
      if (mounted.current) setCandidate(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "이 뜻으로 움직이지 못했어요.",
      );
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const repeat = async () => {
    if (!lastInterpretation || pending || conflict || !ready) return;
    setPending(true);
    setError("");
    try {
      await finishAttempt(
        attemptOnboarding(
          progress,
          lastInterpretation.text,
          lastInterpretation.value,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "다시 실행하지 못했어요.");
    } finally {
      if (mounted.current) setPending(false);
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

  if (isOnboardingComplete(progress)) {
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

  const stage = ONBOARDING_STAGES[progress.currentStage];
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
                <span className="room-tag">정식 도입 · 1-{progress.currentStage + 1}</span>
                <h2>{stage.title}</h2>
              </div>
              <span className="chapter-number">{progress.currentStage + 1} / 12</span>
            </div>
            <div className="canvas-holder legacy-onboarding-canvas">
              <OnboardingCanvas
                stageIndex={presentation?.stageIndex ?? progress.currentStage}
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
              </div>
            )}
            <div className="scene-foot">
              <span><i /> 목표 · {stage.goal}</span>
              <span>무료 지역 복구</span>
            </div>
          </div>
          <PlayStageProgress
            chapter={1}
            stages={STAGE_PROGRESS}
            currentId={`intro:${stage.id}`}
            completedIds={progress.completedStageIds.map((id) => `intro:${id}`)}
          />
          <PlayComposer onSubmit={submit} ariaLabel={`${stage.title} 임시 한 줄`}>
            <label htmlFor="onboarding-instruction">
              이 장면에서만 쓸 임시 한 줄 <span aria-hidden="true">↘</span>
            </label>
            <textarea
              id="onboarding-instruction"
              value={draft}
              onChange={(event) => {
                requestRef.current?.abort();
                setDraft(event.target.value);
                setCandidate(null);
                setLastInterpretation(null);
                setError("");
              }}
              rows={2}
              placeholder="보이는 장면과 용사가 할 행동을 한 줄로 적어 주세요."
              disabled={pending || conflict || !ready}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229 &&
                  !composing.current
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="compose-bottom">
              <span className="count">{[...draft].length} / {CONFIG.maxInstructionLength}</span>
              <button
                type="submit"
                className="primary"
                disabled={
                  pending ||
                  conflict ||
                  !ready ||
                  !draft.trim() ||
                  [...draft].length > CONFIG.maxInstructionLength
                }
              >
                {pending ? "뜻을 확인하는 중…" : "뜻 확인"} {!pending && <span>↗</span>}
              </button>
            </div>
            {candidate && (
              <div className="interpretation legacy-onboarding-interpretation">
                <h4>“이렇게 이해했어요.”</h4>
                <p>
                  행동은 <strong>{ACTION_LABELS[candidate.value.action]}</strong>.{" "}
                  {candidate.value.appliesTo.length > 0
                    ? `${conditionLabels(candidate.value).join(", ")}에서 따를게요.`
                    : "지금까지 알려진 장면에는 적용하지 않을게요."}
                </p>
                <div className="action-row">
                  <button
                    type="button"
                    className="primary"
                    disabled={pending}
                    onClick={() => void confirmCandidate()}
                  >
                    이 뜻으로 움직이기 <span>→</span>
                  </button>
                  <button
                    type="button"
                    className="subtle"
                    disabled={pending}
                    onClick={() => setCandidate(null)}
                  >
                    문장 다시 보기
                  </button>
                </div>
              </div>
            )}
            {message && <p className="legacy-onboarding-result" role="status">{message}</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <div className="legacy-onboarding-tools">
              <button
                type="button"
                className="subtle"
                disabled={pending || !draft}
                onClick={() => {
                  setDraft("");
                  setCandidate(null);
                  setLastInterpretation(null);
                  setPresentation(null);
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
          </PlayComposer>
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
