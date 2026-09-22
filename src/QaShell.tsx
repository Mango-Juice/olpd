import { useRef, useState } from "react";
import App from "./App";
import { StageRoadmap } from "./components/StageRoadmap";
import type { CampaignState } from "./campaign/progress";
import { CampaignPlay } from "./components/CampaignPlay";
import { allStageSegments, isOnboardingSegment } from "./campaign/level";
import { createNotebook } from "./campaign/notebook";
import { STAGES } from "./campaign/catalog";
import { campaignAuthority, type CampaignStoredRun } from "./campaign/authority";
import { resolveStage } from "./campaign/registry";
import { createCampaignRun, createPracticeRun, createStageRun, type StageRun } from "./campaign/run";
import { parseProgram } from "./campaign/validation";
import { newRun, skipTutorial } from "./game/core";
import { createOnboardingProgress, isOnboardingProgress, type OnboardingProgress } from "./game/onboarding";
import { makeSave } from "./game/storage";
import type { Settings } from "./game/types";
import type { StageId } from "./campaign/types";
import "./QaShell.css";

const KEY = "one-line-per-death:qa:v1";
const qaStage = resolveStage;
const authority = campaignAuthority(qaStage);
const initialSettings: Settings = { muted: true, reducedMotion: true };
type Slot = { label: string; run: CampaignStoredRun; onboarding?: OnboardingProgress };
function load(): Record<string, Slot> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).flatMap(([id, value]) => {
      if (!value || typeof value !== "object" || typeof value.label !== "string") return [];
      const run = authority.parse(value.run);
      const stageId = run?.kind === "world" ? run.run.stageId : run?.save.state.tutorial ? 0 : 1;
      return run && (String(stageId) === id || (id === "0" && run.kind === "legacy")) ? [[id, { label: value.label, run, ...(isOnboardingProgress(value.onboarding) ? { onboarding: value.onboarding } : {}) }]] : [];
    }));
  } catch { return {}; }
}
async function interpret(text: string, run: StageRun, signal: AbortSignal) {
  const response = await fetch("/api/qa/campaign-interpret", { method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ text, stageId: run.stageId, runId: run.id, revision: run.revision, attempt: run.world.attempt, world: run.world }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error?.message ?? "뜻을 확인하지 못했어요.");
  const program = parseProgram(value.program);
  if (!program) throw new Error("해석 결과를 읽지 못했어요.");
  return program;
}

/** Separate sandbox: no production progress, migration, archive, or completion writes. */
export default function QaShell() {
  const [settings, setSettings] = useState(initialSettings);
  const [slots, setSlots] = useState(load);
  const slotsRef = useRef(slots);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [practice, setPractice] = useState<StageRun | null>(null);
  const current = selected === null ? null : slots[selected];
  function persist(id: string, slot: Slot, preserveLearning = true): boolean {
    try {
      const currentLearning = slotsRef.current[id]?.onboarding;
      const stored = preserveLearning && currentLearning ? { ...slot, onboarding: currentLearning } : slot;
      const next = { ...slotsRef.current, [id]: stored };
      localStorage.setItem(KEY, JSON.stringify(next)); slotsRef.current = next; setSlots(next); setError(""); return true;
    } catch { setError("QA 기록을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요."); return false; }
  }
  function open(id: number, fresh: boolean) {
    const key = String(id);
    if (!fresh && slots[key]) { setSelected(key); setPractice(null); return; }
    let slot: Slot;
    if (id < 2) {
      slot = { label: id === 0 ? "프롤로그" : "1장 · 기억의 던전", run: { kind: "legacy", save: makeSave(id === 0 ? newRun(true) : skipTutorial(newRun(true)), { writer: "local-qa", settings, tutorialCompleted: id === 1 }) } };
    } else {
      const stage = qaStage(id as StageId);
      if (!stage) return;
      slot = { label: `${id}장 · ${stage.title}`, run: { kind: "world", run: createCampaignRun(crypto.randomUUID(), stage) } };
    }
    if (id === 0 && slot.run.kind === "legacy") slot.onboarding = createOnboardingProgress(slot.run.save.state.id);
    if (persist(key, slot, false)) { setSelected(key); setPractice(null); }
  }
  function jumpToSegment(segmentId: string) {
    if (current?.run.kind !== "world" || selected === null) return;
    const stage = qaStage(current.run.run.stageId);
    const segment = stage && allStageSegments(stage).find((item) => item.id === segmentId);
    if (!stage || !segment) return;
    const world = segment.enter(null);
    const fresh = createStageRun(crypto.randomUUID(), world);
    const introductory = isOnboardingSegment(stage, segmentId);
    const introIndex = stage.onboarding?.findIndex((item) => item.id === segmentId) ?? -1;
    // QA-only seeded learning prefix. This isolated slot never grants campaign completion.
    if (introductory) {
      fresh.notebook = createNotebook(segmentId, true);
      fresh.learning = { completedSegmentIds: stage.onboarding!.slice(0, introIndex).map((item) => item.id), attemptedSentences: [] };
    }
    if (persist(selected, { ...current, run: { kind: "world", run: fresh } })) setPractice(null);
  }
  const back = () => { setSelected(null); setPractice(null); };
  const header = <aside className="qa-banner" aria-label="로컬 QA 모드"><strong>LOCAL QA</strong><span>모든 구현 장 바로 입장 · 일반 진행과 별도 저장 · 실제 AI 호출</span><button onClick={back}>QA 장 선택</button><a href="/">일반 플레이로 돌아가기</a></aside>;
  let content;
  if (current?.run.kind === "legacy") {
    content = <App key={current.run.save.state.id} bridge={{ initial: current.run.save,
      loadOnboarding: () => slotsRef.current[selected!]?.onboarding ?? null,
      saveOnboarding: async (progress) => persist(selected!, { ...slotsRef.current[selected!], onboarding: progress }, false) ? { ok: true, value: undefined } : { ok: false, error: { code: "write", message: "QA 도입 저장 실패" } },
      save: async (save) => persist(selected!, { ...current, run: { kind: "legacy", save } }) ? { ok: true, value: undefined } : { ok: false, error: { code: "write", message: "QA 저장 실패" } },
      onRoadmap: back, onClearedPresentation: back, onArchive: back }} />;
  } else if (current?.run.kind === "world") {
    const stage = qaStage(current.run.run.stageId)!;
    const displayed = practice ?? current.run.run;
    content = <><label className="qa-segment-picker">스테이지 바로 확인 <select aria-label="QA 스테이지 선택" value={current.run.run.world.segmentId} onChange={(event) => jumpToSegment(event.target.value)}>
      {allStageSegments(stage).map((segment, index) => <option key={segment.id} value={segment.id}>{stage.id}-{index + 1} · {segment.title}</option>)}
    </select></label><CampaignPlay key={displayed.id} run={displayed} stage={practice ? { ...stage, onboarding: [], segments: [stage.practice] } : stage}
      settings={settings} onSettingsChange={setSettings} practice={!!practice} interpret={interpret}
      onCommit={async (next) => {
        if (practice) { setPractice(next); return true; }
        return persist(selected!, { ...current, run: { kind: "world", run: next } });
      }}
      onRoadmap={() => practice ? setPractice(null) : back()}
      onPractice={() => setPractice(createPracticeRun(crypto.randomUUID(), stage.practice.enter(null)))} /></>;
  } else {
    const qaCampaign: CampaignState = {
      version: 1, writer: "local-qa-map", revision: 0, settings,
      stages: STAGES.map((stage) => {
        const saved = slots[String(stage.id)]?.run;
        return { stageId: stage.id, status: stage.id === 1 || qaStage(stage.id) ? "unlocked" : "locked", completion: null,
          activeRun: saved ? { stageId: stage.id, runId: saved.kind === "legacy" ? saved.save.state.id : saved.run.id } : null };
      }),
    };
    content = <><StageRoadmap campaign={qaCampaign} qa onSelect={(id) => open(id, false)} onArchive={() => undefined} />
      <details className="qa-roadmap-tools" open><summary>QA 도구 · 프롤로그와 새 모험 시작</summary><main className="qa-map"><p className="eyebrow">PLAYTEST SANDBOX</p><h1>어디부터 확인할까요?</h1><p>클리어 없이 바로 입장합니다. 다시 열면 QA 메모와 진행을 이어갈 수 있습니다.</p>
      <div className="qa-grid">{[{ id: 0, title: "프롤로그" }, ...STAGES].map(({ id, title }) => {
        const available = id < 2 || !!qaStage(id as StageId);
        return <section key={id}><span>{id === 0 ? "INTRO" : `CHAPTER ${String(id).padStart(2, "0")}`}</span><h2>{title}</h2><p>{available ? "QA 입장 가능" : "미구현 · 입장 불가"}</p>
          <button disabled={!available} onClick={() => open(id, false)}>{slots[String(id)] ? "이어 하기" : "바로 입장"}</button>
          {slots[String(id)] && available ? <button className="subtle" onClick={() => open(id, true)}>새 QA 시작</button> : null}</section>;
      })}</div></main></details></>;
  }
  return <>{header}{error ? <p className="qa-error" role="alert">{error}</p> : null}{content}</>;
}
