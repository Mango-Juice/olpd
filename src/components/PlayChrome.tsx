import { useEffect, useRef, useState } from "react";
import type {
  FormEventHandler,
  ReactNode,
  Ref,
} from "react";
import "./PlayChrome.css";

export interface PlayHeaderProps {
  actions: ReactNode;
}

export function PlayHeader({ actions }: PlayHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <img src="/favicon.svg" alt="" /> ONE LINE PER DEATH
      </div>
      <nav className="top-actions" aria-label="게임 설정">
        {actions}
      </nav>
    </header>
  );
}

export interface PlayIntroProps {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}

export function PlayIntro({
  eyebrow = "A LITTLE HERO. YOUR LITTLE WORDS.",
  title = (
    <>
      죽을 때마다 <span>한 줄</span>
    </>
  ),
  description = "용사는 다시 태어나고, 당신의 한 줄은 남습니다.",
  aside = (
    <>
      실패가 기억이 되는 곳<small>A DUNGEON OF SMALL LESSONS</small>
    </>
  ),
}: PlayIntroProps) {
  return (
    <section className="intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="chapter-index">{aside}</div>
    </section>
  );
}

export function PlayLayout({ children }: { children: ReactNode }) {
  return <main className="layout">{children}</main>;
}

export interface PlayStageProgressProps {
  chapter: number;
  stages: readonly { id: string; title: string }[];
  currentId: string;
  completedIds: readonly string[];
}

export function PlayStageProgress({
  chapter,
  stages,
  currentId,
  completedIds,
}: PlayStageProgressProps) {
  const completed = new Set(completedIds);
  const currentIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === currentId),
  );

  return (
    <section
      className="play-stage-progress"
      aria-label={`챕터 ${chapter} 스테이지 진행`}
    >
      <p className="play-stage-progress-heading">
        <span>CHAPTER {chapter}</span>
        <strong>
          {chapter}-{currentIndex + 1} / {stages.length}개 스테이지
        </strong>
      </p>
      <ol>
        {stages.map((stage, index) => {
          const isCurrent = stage.id === currentId;
          const isComplete = completed.has(stage.id);
          return (
            <li
              key={stage.id}
              className={`${isComplete ? "is-complete" : ""}${isCurrent ? " is-current" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="play-stage-marker" aria-hidden="true">
                {isComplete ? "✓" : index + 1}
              </span>
              <span>
                <small>
                  {chapter}-{index + 1} 스테이지
                </small>
                {stage.title}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

export interface PlayNotebookProps {
  count: number;
  children: ReactNode;
  notebookRef?: Ref<HTMLDetailsElement>;
  className?: string;
}

export function PlayNotebook({
  count,
  children,
  notebookRef,
  className,
}: PlayNotebookProps) {
  const localRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 801px)");
    const openOnDesktop = () => {
      if (query.matches && localRef.current) localRef.current.open = true;
    };
    openOnDesktop();
    query.addEventListener("change", openOnDesktop);
    return () => query.removeEventListener("change", openOnDesktop);
  }, []);

  return (
    <details
      className={`notebook paper${className ? ` ${className}` : ""}`}
      ref={(node) => {
        localRef.current = node;
        setRef(notebookRef, node);
      }}
    >
      <summary className="notebook-summary">
        <span>용사의 메모장 · {count}개의 기억</span>
      </summary>
      <div className="paper-content">
        <div className="notebook-heading">
          <Book />
          <h2>용사의 메모장</h2>
        </div>
        {children}
      </div>
    </details>
  );
}

export interface PlayHintsProps {
  hints: readonly string[];
  resetKey: string;
}

const HINT_BUTTON_LABELS = [
  "볼 곳 알려주기",
  "관계 한 가지 알려주기",
  "마지막 실마리 보기",
] as const;

export function PlayHints({ hints, resetKey }: PlayHintsProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [level, setLevel] = useState(0);
  const availableHints = hints.slice(0, 3);

  useEffect(() => {
    setLevel(0);
    if (detailsRef.current) detailsRef.current.open = false;
  }, [resetKey]);

  return (
    <details className="play-hints" ref={detailsRef}>
      <summary>막혔다면 작은 실마리</summary>
      <div className="play-hints-content">
        <div className="play-hints-reveal" aria-live="polite">
          {level === 0 ? (
            <p>원할 때 한 단계씩 열어 볼 수 있어요.</p>
          ) : (
            <ol>
              {availableHints.slice(0, level).map((hint, index) => (
                <li key={`${index}:${hint}`}>{hint}</li>
              ))}
            </ol>
          )}
        </div>
        <button
          type="button"
          className="subtle"
          disabled={level >= availableHints.length}
          onClick={() => setLevel((current) => Math.min(availableHints.length, current + 1))}
        >
          {level >= availableHints.length
            ? "마지막 실마리예요"
            : HINT_BUTTON_LABELS[level] ?? "다음 실마리 보기"}
        </button>
      </div>
    </details>
  );
}

export interface PlayComposerProps {
  children: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  ariaLabel?: string;
}

export function PlayComposer({
  children,
  onSubmit,
  ariaLabel,
}: PlayComposerProps) {
  return (
    <form className="composer" onSubmit={onSubmit} aria-label={ariaLabel}>
      {children}
    </form>
  );
}

function Book() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#7b8468"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <path d="M5 3h13a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Zm1 0v18M9 8h7m-7 4h5" />
    </svg>
  );
}

export function PlayUtilityActions({ muted, onHelp, onToggleSound, onSettings }: { muted: boolean; onHelp: () => void; onToggleSound: () => void; onSettings: () => void }) {
  return <><button className="subtle" onClick={onHelp}>플레이 안내</button><button type="button" className="icon-button" aria-label={muted ? "소리 켜기" : "소리 끄기"} title={muted ? "소리 켜기" : "소리 끄기"} onClick={onToggleSound}>{muted ? <SoundOff /> : <Sound />}</button><button type="button" className="icon-button" aria-label="설정" onClick={onSettings}><Gear /></button></>;
}
function Sound() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    </svg>
  );
}
function SoundOff() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m16 9 6 6m0-6-6 6" />
    </svg>
  );
}
function Gear() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z" />
    </svg>
  );
}
