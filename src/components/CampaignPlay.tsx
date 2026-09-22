import { useEffect, useRef, useState } from "react";
import type { CampaignStageDefinition } from "../campaign/level";
import { allStageSegments, stageDynamics } from "../campaign/level";
import { advanceStage, departStage, rewindStage, type StageRun } from "../campaign/run";
import { CAMPAIGN_INPUT_LIMIT, copyArchivedProgram, deleteProgram, reorderProgram, writeProgram } from "../campaign/notebook";
import { isProgramApplicable } from "../campaign/scheduler";
import { formatProperty } from "../campaign/presentation";
import { preflightProgram } from "../campaign/preflight";
import { parseProgram } from "../campaign/validation";
import type { InstructionProgram, WorldState } from "../campaign/types";
import { stageSummary } from "../campaign/catalog";
import { setMusicPlayback } from "../game/music";
import { unlockAudio, setAudioMuted } from "../game/audio";
import type { Settings } from "../game/types";
import { campaignLearningNote } from "../campaign/learning";
import { usePlayCommand } from "../hooks/usePlayCommand";
import { CampaignCanvas } from "./CampaignCanvas";
import Modal from "./Modal";
import { PlayCommandComposer } from "./PlayCommandComposer";
import { PlayHeader, PlayUtilityActions, PlayIntro, PlayLayout, PlayNotebook, PlayHints, PlayStageProgress } from "./PlayChrome";
import "./CampaignPlay.css";

export interface CampaignPlayProps {
  run: StageRun;
  stage: CampaignStageDefinition;
  settings: Settings;
  onCommit: (next: StageRun) => Promise<boolean>;
  interpret: (text: string, run: StageRun, signal: AbortSignal) => Promise<InstructionProgram>;
  onRoadmap: () => void;
  onPractice: () => void;
  archivedPrograms?: readonly InstructionProgram[];
  archivedTexts?: readonly { id: string; text: string }[];
  practice?: boolean;
  onSettingsChange?: (settings: Settings) => void;
}
function targetName(world: WorldState, id: string): string { return world.entities[id]?.name ?? "이전 구간에서 정한 대상"; }
export function CampaignPlay({ run, stage, settings, onCommit, interpret, onRoadmap, onPractice, archivedPrograms = [], archivedTexts = [], practice = false, onSettingsChange }: CampaignPlayProps) {
  const [draft, setDraft] = useState("");
  const [copyingArchive, setCopyingArchive] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState("");
  const [popup, setPopup] = useState<"help" | "settings" | null>(null);
  const [showStory, setShowStory] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [fast, setFast] = useState(false);
  const live = useRef(run);
  const committing = useRef(false);
  live.current = run;
  const displayedSegments = allStageSegments(stage);
  const quiet = stage.contentRevision === "quiet-v1";
  const learning = !quiet && run.notebook.scratch === true;
  const segment = displayedSegments.find((item) => item.id === run.world.segmentId);
  const musicStageId = stageSummary(stage.id).slug;
  const musicIntensity = learning ? "intro" : run.world.segmentId === stage.segments.at(-1)?.id ? "climax" : "main";
  useEffect(() => {
    const update = () => setMusicPlayback({ stageId: musicStageId, playing: !document.hidden && run.phase !== "cleared", intensity: musicIntensity });
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); setMusicPlayback({ stageId: musicStageId, playing: false }); };
  }, [musicStageId, musicIntensity, run.phase === "cleared"]);
  useEffect(() => setAudioMuted(settings.muted), [settings.muted]);
  const canCopy = !quiet && !learning && !run.notebook.departed && run.notebook.editing;
  const archiveChoices = [...archivedPrograms, ...archivedTexts];
  const canCompose = run.notebook.editing && (run.notebook.canWrite || (copyingArchive && canCopy));
  useEffect(() => { setSelected(undefined); setShowStory(false); }, [run.world.segmentId]);
  async function commit(next: StageRun): Promise<boolean> {
    if (committing.current || live.current.id !== next.id) return false;
    committing.current = true;
    setSaving(true);
    try {
      const saved = await onCommit(next);
      if (!saved) { setPaused(true); setNotice("저장하지 못해 실행을 멈췄어요. 현재 기록을 확인한 뒤 다시 시도해 주세요."); }
      return saved;
    } catch (error) {
      setPaused(true);
      setNotice(error instanceof Error ? error.message : "저장을 완료하지 못했어요.");
      return false;
    } finally { committing.current = false; setSaving(false); }
  }
  useEffect(() => {
    if (paused || saving || (run.phase !== "running" && run.phase !== "waiting")) return;
    let disposed = false;
    const last = run.events[run.events.length - 1];
    const delay = settings.reducedMotion ? 100 : fast || last?.repeated ? 450 : 1300;
    const timer = window.setTimeout(() => {
      if (disposed || document.hidden || committing.current || live.current.revision !== run.revision) return;
      void commit(advanceStage(run, stageDynamics(stage)));
    }, delay);
    const visible = () => { if (!document.hidden && !disposed && live.current.revision === run.revision) setPaused(true); };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
    // The persisted run is the clock. A committed revision schedules one next atomic boundary.
  }, [run, stage, paused, saving, fast, settings.reducedMotion]);
  const command = usePlayCommand<InstructionProgram>({
    contextKey: `${run.id}:${run.world.segmentId}:${run.world.attempt}`,
    maxLength: CAMPAIGN_INPUT_LIMIT,
    timeoutMs: 20_000,
    blocked: saving || !canCompose,
    interpret: (text, signal) => interpret(text, live.current, signal),
    execute: async (interpreted, text) => {
      const current = live.current;
      const parsed = parseProgram(interpreted);
      if (!parsed || parsed.text !== text) throw new Error("문장의 일부를 놓쳤어요. 원문 전체를 다시 확인해 주세요.");
      const replaceId = editingId ?? ((quiet || learning) ? current.notebook.instructions[0]?.id : undefined);
      const notebook = copyingArchive && canCopy
        ? copyArchivedProgram(current.notebook, parsed)
        : writeProgram(current.notebook, parsed, replaceId);
      const preflight = preflightProgram(current, notebook, stageDynamics(stage));
      if (preflight.kind === "clarification") throw new Error(preflight.reason);
      setPaused(false);
      const saved = await commit(departStage({ ...current, notebook }));
      if (!saved) setNotice("");
      return saved;
    },
    onStart: () => { unlockAudio(); setNotice(""); },
    onSuccess: () => { setDraft(""); setEditingId(undefined); setCopyingArchive(false); },
  });
  const cancelCommand = () => { command.cancel(); command.clearError(); };
  useEffect(() => {
    const id = run.notebook.clarificationId;
    if (!id) return;
    const unresolved = run.notebook.instructions.find((program) => program.id === id);
    command.cancel();
    command.clearError();
    setEditingId(id); setDraft(unresolved?.text ?? ""); setNotice("");
  }, [run.id, run.notebook.clarificationId]);
  async function changeNotebook(change: () => StageRun["notebook"]) {
    cancelCommand();
    try {
      const notebook = change();
      if (await commit({ ...run, notebook, revision: run.revision + 1 })) {
        if (editingId && !notebook.instructions.some((program) => program.id === editingId)) { setEditingId(undefined); setDraft(""); }
      }
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "메모를 바꾸지 못했어요."); }
  }
  if (!segment) return <p role="alert">현재 구간을 찾지 못했어요. 저장 원본은 그대로 남아 있어요.</p>;
  const actorVerbs = Object.fromEntries(run.events.filter((event) =>
    event.actor && event.verb && event.id.startsWith(`${run.id}:${run.revision}:`) && event.attempt === run.world.attempt && event.segmentId === run.world.segmentId && event.outcome === "safe",
  ).map((event) => [event.actor, event.verb]));
  const presentedFacts = run.world.facts.flatMap((fact) => {
    const property = formatProperty(run.world, fact.property, fact.value);
    return property ? [{ ...fact, label: property.label, displayValue: property.value }] : [];
  });
  const currentFacts = presentedFacts.filter((fact) => fact.attempt === run.world.attempt);
  const expiredFacts = presentedFacts.filter((fact) => fact.attempt !== run.world.attempt);
  const matching = run.notebook.instructions.filter((program) => isProgramApplicable(run.world, program));
  const correctionId = run.notebook.clarificationId;
  const editCost = (id: string) => learning || correctionId === id ? "무료 확인" : run.notebook.erasers > 0 ? "지우개 1개" : "종 3회";
  const progress = !practice ? <PlayStageProgress chapter={stage.id} stages={displayedSegments} currentId={run.world.segmentId} completedIds={[...(run.learning?.completedSegmentIds ?? []), ...run.clearedSegments]} /> : null;
  const latestSceneEvent = [...run.events].reverse().find((event) => event.segmentId === segment.id && event.attempt === run.world.attempt);
  const feedback = saving
    ? "저장하고 있어요…"
    : notice || (quiet && run.phase === "bookmark"
      ? run.statusReason ?? (run.notebook.instructions.length ? "한 줄을 고치거나 다시 시도해 보세요." : "이 장면에서 해 볼 한 줄을 적어 보세요.")
      : run.phase === "bookmark" && displayedSegments.indexOf(segment) > 0
        ? `${stage.id}-${displayedSegments.indexOf(segment) + 1} · ${segment.title}. ${learning ? "새 장면에서 한 줄을 자유롭게 써 보세요." : "다음 스테이지에서 한 줄을 더 남길 수 있어요."}`
        : quiet ? latestSceneEvent?.reason ?? run.statusReason : run.statusReason) || "";
  return <div className={`shell campaign-play${quiet ? " is-quiet" : ""}`} onPointerDownCapture={unlockAudio} onKeyDownCapture={unlockAudio}>
    <PlayHeader actions={<>
      <button type="button" className="subtle" disabled={saving} onClick={() => { cancelCommand(); onRoadmap(); }}>{practice ? "연습 마치기" : "여정 지도"}</button>
      <PlayUtilityActions muted={settings.muted} onHelp={() => setPopup("help")} onToggleSound={() => onSettingsChange?.({ ...settings, muted: !settings.muted })} onSettings={() => setPopup("settings")} />
    </>} />
    <PlayIntro description={stage.objective} aside={<>{stage.title}<small>CHAPTER {String(stage.id).padStart(2, "0")}{practice ? " · 연습" : ""}</small></>} />
    <PlayLayout>
      <section className="game-panel" aria-label="던전 플레이">
        <div className="scene-frame campaign-scene">
          <CampaignCanvas world={run.world} scene={segment.scene} actorVerbs={actorVerbs} displayNumber={displayedSegments.indexOf(segment) + 1} title={segment.title} reducedMotion={settings.reducedMotion} paused={paused || run.phase === "bookmark" || run.phase === "cleared"} selectedEntityId={selected} onSelectEntity={setSelected} />
          <p className="campaign-goal" aria-live="polite">{quiet ? null : <span>이번 목표</span>}{segment.goal}</p>
        </div>
        {quiet ? null : progress}
        {quiet ? null : <p className="campaign-learning">{learning ? "적은 대로 움직여요. 마음껏 고치고 다시 해 봐도 괜찮아요." : campaignLearningNote(run)}</p>}
        <p role="status" aria-live="polite" className="campaign-status">{feedback}</p>
        {canCompose ? <PlayCommandComposer
          id="campaign-instruction"
          value={draft}
          onChange={setDraft}
          onSubmit={command.submit}
          onCancel={cancelCommand}
          pending={command.pending}
          error={command.error}
          disabled={saving}
          maxLength={CAMPAIGN_INPUT_LIMIT}
          label={quiet ? (editingId ? "메모 고치기" : "무엇을 할까요?") : copyingArchive ? "지난 메모를 이 장면에 맞게 가져오기" : editingId ? "메모를 고쳐 쓰기" : learning ? "이 장면에서 해 볼 한 줄" : "이번 생에 남길 한 줄"}
          placeholder="용사가 할 행동을 한 줄로 적어 주세요."
        >
          {copyingArchive ? <button type="button" className="subtle" onClick={() => { cancelCommand(); setCopyingArchive(false); setDraft(""); }}>복사 취소</button> : null}
          {editingId && !correctionId ? <button type="button" className="subtle" onClick={() => { cancelCommand(); setEditingId(undefined); setDraft(""); }}>{quiet ? "수정 취소" : "수정 취소 · 새 줄 쓰기"}</button> : null}
        </PlayCommandComposer> : null}
        <div className="campaign-controls">
          {run.phase === "bookmark" && run.notebook.instructions.length > 0 ? <button type="button" className="secondary" disabled={saving || command.pending || !!correctionId} onClick={() => { cancelCommand(); setPaused(false); void commit(departStage(run)); }}>같은 한 줄 다시 실행</button> : null}
          {!quiet && run.phase === "bookmark" && !run.notebook.instructions.length && !learning && !!segment.idleAction?.(run.world) ? <button type="button" className="primary" disabled={saving || command.pending} onClick={() => { cancelCommand(); setPaused(false); void commit(departStage(run)); }}>열린 길 따라가기 →</button> : null}
          {run.phase === "running" || run.phase === "waiting" ? <button type="button" className="primary" onClick={() => setPaused(!paused)} disabled={saving}>{paused ? "계속 걷기" : "잠시 멈추기"}</button> : null}
          {run.phase === "cleared" ? <button type="button" className="primary" onClick={onRoadmap}>{practice ? "연습 마치기" : "다음 문을 보러 가기 →"}</button> : null}
          {run.notebook.departed && run.phase !== "cleared" ? <button type="button" className="secondary" disabled={saving || !!correctionId} onClick={() => { cancelCommand(); setPaused(false); void commit(rewindStage(run)); }}>{quiet ? "처음부터 다시 · 무료" : practice || learning ? "이 장면 처음으로 · 무료" : "종 1회 · 되감고 한 줄 쓰기"}</button> : null}
        </div>
        <PlayHints hints={segment.hints} resetKey={`${run.id}:${segment.id}`} />
        {quiet ? progress : null}
        {quiet ? null : <><details className="campaign-tools"><summary>플레이 도구</summary><label><input type="checkbox" checked={fast} onChange={(event) => setFast(event.target.checked)} /> 빠르게 재생</label><button type="button" className="subtle" disabled={saving || run.notebook.departed || learning} onClick={() => { cancelCommand(); onPractice(); }}>비용 없는 연습</button>{!run.notebook.departed ? <button type="button" className="subtle" disabled={saving || !!correctionId} onClick={() => { cancelCommand(); setPaused(false); void commit(rewindStage(run)); }}>{practice || learning ? "이 장면 처음으로 · 무료" : "종 1회 · 되감고 한 줄 쓰기"}</button> : null}</details>
        <div className="stats"><strong>{learning ? "∞" : run.notebook.bells}</strong>{" "}<span>{learning ? "배우는 동안은 수정과 재시작이 무료예요" : practice ? "연습 · 본편 기록에 남지 않아요" : "종 · 되감은 횟수"}</span></div>
        <details className="campaign-history"><summary>이번 시도의 관찰과 발자국</summary>{currentFacts.length ? <ul>{currentFacts.slice(-20).map((fact, index) => <li key={`${fact.entity}:${fact.property}:${index}`}>{targetName(run.world, fact.entity)} · {fact.label}: {fact.displayValue}</li>)}</ul> : <p>아직 따로 기억한 사실이 없어요.</p>}{expiredFacts.length ? <details className="campaign-expired-facts"><summary>지난 시도의 관찰 · 근거 무효</summary><p>되감기 전의 기록이에요. 이번 시도에서 다시 관찰해야 조건으로 쓸 수 있어요.</p><ul>{expiredFacts.slice(-20).map((fact, index) => <li key={`${fact.attempt}:${fact.entity}:${fact.property}:${index}`}><span>시도 {fact.attempt} · 닫힌 눈 · </span><s>{targetName(run.world, fact.entity)} · {fact.label}: {fact.displayValue}</s></li>)}</ul></details> : null}<ol>{run.events.slice(-30).map((event) => <li key={event.id}>{event.reason}</li>)}</ol></details></>}
        {run.clearedSegments.includes(stage.story.afterSegment) ? <aside className="campaign-story"><button type="button" className="subtle" onClick={() => setShowStory(!showStory)}>{run.world.entities[stage.story.object]?.name ?? stage.story.object} 살펴보기 · 선택</button>{showStory ? <p>{stage.story.text}</p> : null}</aside> : null}
      </section>
      <PlayNotebook count={run.notebook.instructions.length}>
        {quiet ? null : <p className="memory-priority">상황이 맞으면 위쪽 메모부터 ↓</p>}
        {!quiet && matching.length > 1 ? <p className="campaign-overlap">지금은 위쪽 줄을 먼저 따라가요.</p> : null}
        <ol className="campaign-notes instruction-list">{run.notebook.instructions.map((program, index) => {
          const edit = <button type="button" disabled={!run.notebook.editing || !run.notebook.canWrite || saving || (!!correctionId && correctionId !== program.id)} onClick={() => { cancelCommand(); setCopyingArchive(false); setDraft(program.text); setEditingId(program.id); }}>{quiet ? "수정" : `수정 · ${editCost(program.id)}`}</button>;
          const remove = <button type="button" disabled={!run.notebook.editing || saving || (!!correctionId && correctionId !== program.id)} onClick={() => void changeNotebook(() => deleteProgram(run.notebook, program.id))}>{quiet ? "삭제" : `삭제 · ${editCost(program.id)}`}</button>;
          return <li key={program.id} className={`instruction ${run.execution.active?.instructionId === program.id ? "active" : ""}`}>
            <p>{program.text}</p>
            {quiet ? <div className="campaign-note-actions">{edit}{remove}</div> : <details className="campaign-note-tools"><summary>메모 관리</summary><button type="button" aria-label={`${program.text} 위로`} disabled={!run.notebook.editing || saving || index === 0} onClick={() => void changeNotebook(() => reorderProgram(run.notebook, program.id, index - 1))}>↑</button><button type="button" aria-label={`${program.text} 아래로`} disabled={!run.notebook.editing || saving || index === run.notebook.instructions.length - 1} onClick={() => void changeNotebook(() => reorderProgram(run.notebook, program.id, index + 1))}>↓</button>{edit}{remove}</details>}
          </li>;
        })}</ol>
        {!run.notebook.instructions.length ? <p className="empty-note">{quiet ? "아직 적은 메모가 없어요." : <>아직 남긴 한 줄이 없어요.<br />첫 번째 기억을 남겨 주세요.</>}</p> : null}
        {quiet ? <p className="paper-note">이 메모는 지금 장면에서 자유롭게 고칠 수 있어요.</p> : !learning ? <><div className="paper-foot"><span>남은 지우개</span><div className="erasers" aria-label={`지우개 ${run.notebook.erasers}개`}>{[0, 1].map((index) => <span key={index} className={`eraser ${index >= run.notebook.erasers ? "spent" : ""}`} />)}</div></div>
        <p className="paper-note">지우개를 다 쓰면, 한 줄을 지울 때 종 3회.</p></> : <p className="paper-note">이 한 줄은 이 장면에서만 써요. 본편 메모는 따로 시작해요.</p>}
        {!quiet && run.learning?.attemptedSentences.length ? <details className="campaign-learning-history"><summary>도입에서 써 본 문장</summary><p>참고 기록이에요. 현재 메모로 실행되지는 않아요.</p><ol>{run.learning.attemptedSentences.map((entry, index) => <li key={`${entry.segmentId}:${index}`}>{entry.text}</li>)}</ol></details> : null}
        {canCopy && archiveChoices.length > 0 ? <details><summary>지난 장의 메모 가져오기 · 무료</summary><p>현재 물건에 맞게 한 줄을 고친 뒤 바로 실행할 수 있어요.</p>{archiveChoices.map((program) => <button type="button" key={program.id} className="subtle" disabled={saving} onClick={() => { cancelCommand(); setCopyingArchive(true); setEditingId(undefined); setDraft(program.text); }}>{program.text}</button>)}</details> : null}
      </PlayNotebook>
    </PlayLayout>
    {stage.id === 10 && run.phase === "cleared" && !practice ? <Modal title="편지가 닿은 곳" onClose={onRoadmap}>
      <p>편지를 펼치자, 받는 사람 칸에 용사의 이름이 적혀 있었어요.</p>
      <blockquote>여기까지는 내가 길을 적었어. 다음 길은 네가 골라 줘.</blockquote>
      <p>종에 머물던 작은 불빛이 곁으로 돌아왔어요. 보조 인형도 안전선 안에서 조용히 기다리고 있었죠.</p>
      <p>용사는 마지막 빈 줄에 적었어요. “이제는 같이 가자.”</p>
      <button type="button" className="primary" onClick={onRoadmap}>여정 지도로</button>
      <button type="button" className="subtle" onClick={onRoadmap}>엔딩 건너뛰기</button>
    </Modal> : null}
    <footer className="footer"><span>진행은 안전하게 자동 저장됩니다.</span><button className="subtle" onClick={() => { cancelCommand(); onRoadmap(); }}>여정 지도</button></footer>
    {popup === "help" ? <Modal title="한 줄이 길이 되는 모험" onClose={() => setPopup(null)}>{quiet ? <p>장면을 보고 행동을 한 줄로 적으세요. Enter를 누르면 읽고 바로 출발해요.</p> : <><p>용사가 할 행동을 한 줄로 적고 Enter를 누르면 바로 출발해요.</p><p>위쪽 메모를 먼저 따릅니다. 막혔다면 작은 실마리를 열어 보세요.</p></>}</Modal> : null}
    {popup === "settings" ? <Modal title="설정" onClose={() => setPopup(null)}><label><input type="checkbox" checked={settings.reducedMotion} onChange={(event) => onSettingsChange?.({ ...settings, reducedMotion: event.target.checked })} /> 움직임 줄이기</label><button className="secondary" onClick={() => onSettingsChange?.({ ...settings, muted: !settings.muted })}>{settings.muted ? "소리 켜기" : "소리 끄기"}</button></Modal> : null}
  </div>;
}
