import { useState } from "react";
import App from "./App";
import { CampaignPlay } from "./components/CampaignPlay";
import { STAGES } from "./campaign/catalog";
import { campaignAuthority, type CampaignStoredRun } from "./campaign/authority";
import { resolveStage } from "./campaign/registry";
import { THEATRE_STAGE } from "./campaign/stages/theatre";
import { createStageRun, type StageRun } from "./campaign/run";
import { parseProgram } from "./campaign/validation";
import { newRun, skipTutorial } from "./game/core";
import { makeSave } from "./game/storage";
import type { Settings } from "./game/types";
import type { StageId } from "./campaign/types";
import "./QaShell.css";

const KEY = "one-line-per-death:qa:v1";
const qaStage = (id: StageId) => id === 7 ? THEATRE_STAGE : resolveStage(id);
const authority = campaignAuthority(qaStage);
const initialSettings: Settings = { muted: true, reducedMotion: true };
type Slot = { label: string; run: CampaignStoredRun };
function load(): Record<string, Slot> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).flatMap(([id, value]) => {
      if (!value || typeof value !== "object" || typeof value.label !== "string") return [];
      const run = authority.parse(value.run);
      const stageId = run?.kind === "world" ? run.run.stageId : run?.save.state.tutorial ? 0 : 1;
      return run && (String(stageId) === id || (id === "0" && run.kind === "legacy")) ? [[id, { label: value.label, run }]] : [];
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
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [practice, setPractice] = useState<StageRun | null>(null);
  const current = selected === null ? null : slots[selected];
  function persist(id: string, slot: Slot): boolean {
    try {
      const next = { ...slots, [id]: slot };
      localStorage.setItem(KEY, JSON.stringify(next)); setSlots(next); setError(""); return true;
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
      slot = { label: `${id}장 · ${stage.title}`, run: { kind: "world", run: createStageRun(crypto.randomUUID(), stage.segments[0].enter(null)) } };
    }
    if (persist(key, slot)) { setSelected(key); setPractice(null); }
  }
  const back = () => { setSelected(null); setPractice(null); };
  const header = <aside className="qa-banner" aria-label="로컬 QA 모드"><strong>LOCAL QA</strong><span>모든 구현 장 바로 입장 · 일반 진행과 별도 저장 · 실제 AI 호출</span><button onClick={back}>QA 장 선택</button><a href="/">일반 플레이로 돌아가기</a></aside>;
  let content;
  if (current?.run.kind === "legacy") {
    content = <App key={current.run.save.state.id} bridge={{ initial: current.run.save,
      save: async (save) => persist(selected!, { ...current, run: { kind: "legacy", save } }) ? { ok: true, value: undefined } : { ok: false, error: { code: "write", message: "QA 저장 실패" } },
      onRoadmap: back, onClearedPresentation: back, onArchive: back }} />;
  } else if (current?.run.kind === "world") {
    const stage = qaStage(current.run.run.stageId)!;
    const displayed = practice ?? current.run.run;
    content = <CampaignPlay key={displayed.id} run={displayed} stage={practice ? { ...stage, segments: [stage.practice] } : stage}
      settings={settings} onSettingsChange={setSettings} practice={!!practice} interpret={interpret}
      onCommit={async (next) => {
        if (practice) { setPractice(next); return true; }
        return persist(selected!, { ...current, run: { kind: "world", run: next } });
      }}
      onRoadmap={() => practice ? setPractice(null) : back()}
      onPractice={() => setPractice(createStageRun(crypto.randomUUID(), stage.practice.enter(null)))} />;
  } else {
    content = <main className="qa-map"><p className="eyebrow">PLAYTEST SANDBOX</p><h1>어디부터 확인할까요?</h1><p>클리어 없이 바로 입장합니다. 다시 열면 QA 메모와 진행을 이어갈 수 있습니다.</p>
      <div className="qa-grid">{[{ id: 0, title: "프롤로그" }, ...STAGES].map(({ id, title }) => {
        const available = id < 2 || !!qaStage(id as StageId);
        return <section key={id}><span>{id === 0 ? "INTRO" : `CHAPTER ${String(id).padStart(2, "0")}`}</span><h2>{title}</h2><p>{id === 7 ? "실험 중 · 물리 구현, 제품 검증 미완료" : available ? "QA 입장 가능" : "미구현 · 입장 불가"}</p>
          <button disabled={!available} onClick={() => open(id, false)}>{slots[String(id)] ? "이어 하기" : "바로 입장"}</button>
          {slots[String(id)] && available ? <button className="subtle" onClick={() => open(id, true)}>새 QA 시작</button> : null}</section>;
      })}</div></main>;
  }
  return <>{header}{error ? <p className="qa-error" role="alert">{error}</p> : null}{content}</>;
}
