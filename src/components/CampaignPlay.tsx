import { PlayFooter } from "./PlayFooter";
import { useEffect, useRef, useState } from "react";
import { allStageSegments, stageDynamics, type CampaignStageDefinition } from "../campaign/level";
import {
  acknowledgePresentation, advanceStage, resumeConsumedRules, abandonStage, departStage, retryStage,
  writeStageProgram, deleteStageProgram, moveStageProgram, placeStageProgram, type StageRun,
} from "../campaign/run";
import { CAMPAIGN_INPUT_LIMIT } from "../campaign/notebook";
import { preflightProgram } from "../campaign/preflight";
import { parseProgram } from "../campaign/validation";
import type { InstructionProgram, ProgramNode } from "../campaign/types";
import { stageSummary } from "../campaign/catalog";
import { setMusicPlayback } from "../game/music";
import { unlockAudio, setAudioMuted, playSound } from "../game/audio";
import type { Settings } from "../game/types";
import { usePlayCommand } from "../hooks/usePlayCommand";
import { useMobileKeyboardLayout } from "../hooks/useMobileKeyboardLayout";
import { CampaignCanvas } from "./CampaignCanvas";
import { firstContactHint } from "../campaign/contact-hints";
import { PlayContactHint } from "./PlayContactHint";
import { isAbandonPresentation } from "../render/animation";
import { CampaignChronicle } from "./CampaignChronicle";
import { MemoryNotebook } from "./MemoryNotebook";
import Modal from "./Modal";
import { PlayCommandComposer } from "./PlayCommandComposer";
import { PlayHeader, PlayUtilityActions, PlayIntro, PlayLayout, PlayHints, PlayStageProgress } from "./PlayChrome";
import { PlaySceneCaption, PlaySceneFooter, PlaySessionControls, PlayLaunchControls, PlayDeathScore, PlayClearPanel } from "./PlaySessionControls";
import { PlayHelpDialog, PlaySettingsDialog, PlayShareDialog, PlayRestartDialog } from "./PlayDialogs";
import "./CampaignPlay.css";

export interface CampaignPlayProps {
  run: StageRun;
  stage: CampaignStageDefinition;
  settings: Settings;
  onCommit: (next: StageRun) => Promise<boolean>;
  interpret: (text: string, run: StageRun, signal: AbortSignal) => Promise<InstructionProgram>;
  onRoadmap: () => void;
  onNewChallenge?: () => void;
  best?: number | null;
  onSettingsChange?: (settings: Settings) => void;
}

const VERB_LABELS: Record<string, string> = {
  move: "걷기", jump: "뛰기", duck: "숙이기", detour: "우회하기", take: "집기", drop: "내려놓기",
  place: "놓기", push: "밀기", pull: "당기기", turn: "돌리기", open: "열기", close: "닫기",
  hold: "붙잡기", release: "놓아주기", tie: "묶기", untie: "풀기", pour: "붓기", fill: "채우기",
  inspect: "살펴보기", board: "타기", observe: "살펴보기", remember: "기억하기", climb: "오르기", dismount: "내리기", wait: "기다리기",
};
function actionLabel(node: ProgramNode): string {
  if (node.kind === "action") return VERB_LABELS[node.verb] ?? "행동하기";
  if (node.kind === "wait") return "기다리기";
  if (node.kind === "sequence") return node.children.map(actionLabel).join(" → ");
  if (node.kind === "parallel") return "함께 움직이기";
  return "상황을 보고 행동하기";
}
function downloadRun(run: StageRun) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `one-line-per-death-chapter-${run.stageId}.json`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CampaignPlay({ run, stage, settings, onCommit, interpret, onRoadmap, onNewChallenge,
  best, onSettingsChange }: CampaignPlayProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [notice, setNotice] = useState("");
  const [failedSave, setFailedSave] = useState<StageRun | null>(null);
  const [popup, setPopup] = useState<"help" | "settings" | "share" | "new" | "ending" | null>(null);
  const [showChronicle, setShowChronicle] = useState(false);
  const [showStory, setShowStory] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [sceneByScene, setSceneByScene] = useState(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [shareInstructions, setShareInstructions] = useState(false);
  const keyboard = useMobileKeyboardLayout(draft.length > 0);
  const live = useRef(run);
  const committing = useRef(false);
  const acknowledged = useRef<string | null>(null);
  const stepMode = useRef(sceneByScene);
  live.current = run;
  stepMode.current = sceneByScene;
  const displayedSegments = allStageSegments(stage);
  const presentation = run.presentation;
  const lastPresentation = run.presentationHistory.at(-1);
  const settledPresentation = !presentation && lastPresentation && ["death", "blocked", "cleared"].includes(lastPresentation.outcome)
    && lastPresentation.after.segmentId === run.world.segmentId ? lastPresentation : null;
  const displayedId = presentation?.outcome === "revive" ? presentation.after.segmentId : presentation?.before.segmentId ?? run.world.segmentId;
  const segment = displayedSegments.find((item) => item.id === displayedId);
  const animating = !!presentation;
  const resting = !animating && (run.phase === "bookmark" || run.phase === "failed");
  const canCompose = resting && run.notebook.canWrite && !failedSave;
  const musicStageId = stageSummary(stage.id).slug;
  const musicIntensity = displayedId === stage.segments.at(-1)?.id ? "climax" : "main";
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    setMusicPlayback({ stageId: musicStageId, playing: !hidden && !paused && !showChronicle && !popup && !failedSave && (run.phase !== "cleared" || animating), intensity: musicIntensity });
    return () => setMusicPlayback({ stageId: musicStageId, playing: false });
  }, [musicStageId, musicIntensity, hidden, paused, showChronicle, popup, failedSave, run.phase, animating]);
  useEffect(() => setAudioMuted(settings.muted), [settings.muted]);
  useEffect(() => { setSelected(undefined); setShowStory(false); }, [displayedId]);

  async function commit(next: StageRun): Promise<boolean> {
    if (committing.current || live.current.id !== next.id) return false;
    if (next === live.current) return true;
    committing.current = true;
    setSaving(true);
    try {
      const saved = await onCommit(next);
      if (saved) { live.current = next; setFailedSave(null); }
      else { setPaused(true); setFailedSave(next); setNotice("저장하지 못해 실행을 멈췄어요. 다시 저장하거나 현재 기록을 보관해 주세요."); }
      return saved;
    } catch (error) {
      setPaused(true); setFailedSave(next);
      setNotice(error instanceof Error ? error.message : "저장을 완료하지 못했어요.");
      return false;
    } finally { committing.current = false; setSaving(false); }
  }
  // The animation callback is the only boundary that releases the next judgement.
  // No elapsed-time timer may move the world independently of its presentation.
  useEffect(() => {
    if (paused || hidden || saving || failedSave || awaitingNext || showChronicle || popup || run.presentation) return;
    const resumed = resumeConsumedRules(run);
    if (resumed !== run) { void commit(resumed); return; }
    if (run.phase !== "running" && run.phase !== "waiting") return;
    if (committing.current || live.current.revision !== run.revision) return;
    void commit(advanceStage(run, stageDynamics(stage)));
  }, [run, stage, paused, hidden, saving, failedSave, awaitingNext, showChronicle, popup]);

  async function playbackEnded() {
    const current = live.current;
    const record = current.presentation;
    if (!record || acknowledged.current === record.id || committing.current) return;
    acknowledged.current = record.id;
    if (stepMode.current && (current.phase === "running" || current.phase === "waiting")) setAwaitingNext(true);
    if (!(await commit(acknowledgePresentation(current)))) acknowledged.current = null;
  }
  const nextScene = () => { setAwaitingNext(false); setPaused(false); };
  const command = usePlayCommand<InstructionProgram>({
    contextKey: `${run.id}:${run.phase}:${run.world.attempt}:${run.notebook.instructions.length}`,
    maxLength: CAMPAIGN_INPUT_LIMIT,
    timeoutMs: 20_000,
    blocked: saving || !canCompose,
    interpret: (text, signal) => interpret(text, live.current, signal),
    execute: async (interpreted, text) => {
      const current = live.current;
      const parsed = parseProgram(interpreted);
      if (!parsed || parsed.text !== text) throw new Error("문장의 일부를 놓쳤어요. 원문 전체를 다시 확인해 주세요.");
      const written = writeStageProgram(current, parsed);
      const preflight = preflightProgram(current, written.notebook, stageDynamics(stage));
      if (preflight.kind === "clarification") throw new Error(preflight.reason);
      const started = departStage(written.phase === "failed" ? retryStage(written) : written);
      setPaused(false); setAwaitingNext(false);
      const saved = await commit(started);
      if (saved) { playSound("write", settings.muted); setDraft(""); }
      return saved;
    },
    onStart: () => { unlockAudio(); setNotice(""); },
    onSuccess: () => setDraft(""),
  });
  const cancelCommand = () => { command.cancel(); command.clearError(); };
  async function launch() {
    cancelCommand(); setNotice(""); setPaused(false); setAwaitingNext(false);
    const current = live.current;
    await commit(departStage(current.phase === "failed" ? retryStage(current) : current));
  }
  async function changeNotebook(change: (current: StageRun) => StageRun): Promise<boolean> {
    cancelCommand();
    try { return await commit(change(live.current)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "메모를 바꾸지 못했어요."); return false; }
  }
  function openChronicle() { cancelCommand(); setPaused(true); setShowChronicle(true); }
  const shareText = [
    `죽을 때마다 한 줄 · ${stage.title}`,
    `${run.notebook.deaths + run.notebook.penaltyDeaths}데스의 기억`,
    shareInstructions ? [...run.notebook.instructions].reverse().map((note, i) => `${i + 1}. ${note.text}`).join("\n") : "",
    typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`,
  ].filter(Boolean).join("\n\n");
  const shownPresentation = presentation ?? settledPresentation;
  const abandoned = !!shownPresentation && isAbandonPresentation(shownPresentation);
  const activeId = abandoned ? undefined : shownPresentation?.events.find((event) => event.instructionId)?.instructionId;
  if (!segment) return <p role="alert">현재 구간을 찾지 못했어요. 저장 원본은 그대로 남아 있어요.</p>;
  const canReorder = resting && !saving && !command.pending && !failedSave;
  const completedIds = animating && presentation?.completedSegmentId
    ? run.clearedSegments.filter((id) => id !== presentation.completedSegmentId) : run.clearedSegments;
  return <div className={`shell campaign-play${keyboard ? " keyboard-open" : ""}`} onPointerDownCapture={unlockAudio} onKeyDownCapture={unlockAudio}>
    <PlayHeader actions={<>
      <button type="button" className="subtle" disabled={saving} onClick={() => { cancelCommand(); onRoadmap(); }}>여정 지도</button>
      <PlayUtilityActions muted={settings.muted} onHelp={() => setPopup("help")} onToggleSound={() => onSettingsChange?.({ ...settings, muted: !settings.muted })} onSettings={() => setPopup("settings")} />
    </>} />
    <PlayIntro description={stage.objective} aside={<>{stage.title}<small>CHAPTER {String(stage.id).padStart(2, "0")}</small></>} />
    {failedSave && <aside className="error" role="alert"><p>{notice}</p><div className="action-row">
      <button className="secondary" disabled={saving} onClick={() => { void commit(failedSave).then((ok) => { if (ok) { setNotice(""); setPaused(false); } }); }}>저장 다시 시도</button>
      <button className="secondary" onClick={() => downloadRun(failedSave)}>원본 기록 내보내기</button>
    </div></aside>}
    <PlayLayout>
      <section className="game-panel" aria-label="던전 플레이">
        <div className="scene-frame campaign-scene">
          <CampaignCanvas world={run.world} scene={segment.scene} presentation={presentation} settledPresentation={settledPresentation} onPlaybackEnd={() => { void playbackEnded(); }}
            onSound={(cue) => playSound(cue, settings.muted)} displayNumber={displayedSegments.indexOf(segment) + 1}
            title={segment.title} reducedMotion={settings.reducedMotion} paused={paused || hidden || saving || showChronicle || !!popup || !!failedSave}
            selectedEntityId={selected} onSelectEntity={setSelected} />
          {(animating || run.phase === "failed" || run.phase === "blocked") && <PlaySceneCaption
            returning={presentation?.outcome === "revive"} accident={!animating && run.phase === "failed"} animating={animating}
            kicker={presentation?.outcome === "revive" ? "다시, 던전 입구에서" : !animating ? "방금 무슨 일이 있었냐면…" : abandoned ? "다시 준비하기" : activeId ? "기억한 말" : run.phase === "blocked" ? "지시를 기다리는 중" : "주변의 변화"}
            memory={abandoned ? "입구에서 다시 준비할게." : presentation?.outcome === "revive" ? "몸은 다시 태어나도, 메모는 꼭 챙겨 갈게." : activeId ? `“${run.notebook.instructions.find((note) => note.id === activeId)?.text ?? "남겨 둔 지시"}”` : run.phase === "blocked" ? "지금 할 행동을 알려주세요." : "주변이 움직이고 있어요."}
            action={abandoned ? "남긴 메모를 챙기고 있어요" : presentation?.outcome === "revive" ? "처음부터 다시 걸어가요" : !animating ? run.statusReason : VERB_LABELS[presentation?.events.find((event) => event.verb)?.verb ?? ""] ?? "상황을 지켜보기"}><PlayContactHint text={firstContactHint(run, stage)} /></PlaySceneCaption>}
          <p className="campaign-goal">{segment.goal}</p>
          <PlaySceneFooter label={stage.title} status={command.pending ? "용사가 한 줄을 읽고 있어요" : paused || hidden ? "잠시 쉬어가는 중"
            : animating && presentation?.repeated ? "기억하는 길 · 3배속" : run.phase === "failed" ? "넘어진 자리에도 기억은 남아"
              : run.phase === "cleared" ? "던전 탈출 성공 · 모든 한 줄의 기억" : "천천히, 한 걸음씩"}
            playing={animating || run.phase === "running" || run.phase === "waiting"} paused={paused || awaitingNext}
            onTogglePause={() => awaitingNext ? nextScene() : setPaused((value) => !value)} />
        </div>
        <PlaySessionControls sceneByScene={sceneByScene} onSceneByScene={(value) => { setSceneByScene(value); stepMode.current = value; if (!value && awaitingNext) nextScene(); }}
          awaitingNext={awaitingNext} onNext={nextScene} hasHistory={run.events.length > 0} onHistory={openChronicle} />
        <PlayStageProgress chapter={stage.id} stages={displayedSegments} currentId={displayedId} completedIds={completedIds} />
        {!animating && run.statusReason && <p role="status" className="campaign-status">{run.statusReason}</p>}
        {canCompose && <><PlayCommandComposer id="campaign-instruction" value={draft} onChange={setDraft} onSubmit={command.submit}
          onCancel={cancelCommand} pending={command.pending} error={command.error} disabled={saving} maxLength={CAMPAIGN_INPUT_LIMIT}
          label="이번 생에서 남길 한 줄" placeholder="이럴 때는, 이렇게 해줘…" />
          <PlayHints hints={segment.hints} resetKey={`${run.id}:${segment.id}`} /></>}
        {resting && <PlayLaunchControls dead={run.phase === "failed"} canWrite={run.notebook.canWrite} disabled={saving || command.pending || !!failedSave} onLaunch={() => { void launch(); }} />}
        {!animating && run.phase === "blocked" && <button type="button" className="primary wide" disabled={saving || !!failedSave} onClick={() => { setPaused(false); setAwaitingNext(false); void commit(abandonStage(live.current)); }}>부활하고 · +1데스</button>}
        {!animating && run.phase === "cleared" && <PlayClearPanel deaths={run.notebook.deaths} penaltyDeaths={run.notebook.penaltyDeaths} best={best}
          onShare={() => { setNotice(""); setPopup("share"); }} onNew={() => setPopup("new")}>
          {stage.id === 10 ? <button className="secondary" onClick={() => setPopup("ending")}>편지를 펼치기</button> : null}
          <button className="secondary" onClick={onRoadmap}>여정 지도로 →</button>
        </PlayClearPanel>}
        {notice && !failedSave && <p className="helper" role="status">{notice}</p>}
        <PlayDeathScore deaths={run.notebook.deaths - (presentation?.outcome === "death" ? 1 : 0)} penaltyDeaths={run.notebook.penaltyDeaths} best={best} />
        {!animating && run.clearedSegments.includes(stage.story.afterSegment) && <aside className="campaign-story"><button className="subtle" onClick={() => setShowStory(!showStory)}>남겨진 이야기 살펴보기</button>{showStory && <p>{stage.story.text}</p>}</aside>}
      </section>
      <MemoryNotebook entries={[...run.notebook.instructions].reverse().map((program) => ({ id: program.id, text: program.text, actionLabel: actionLabel(program.body) }))}
        erasers={run.notebook.erasers} activeId={activeId} animating={animating} reviving={presentation?.outcome === "revive"}
        canDelete={canReorder && run.phase === "failed"} canReorder={canReorder} busy={saving || command.pending || !!failedSave} reducedMotion={settings.reducedMotion}
        onDelete={async (id) => { const saved = await changeNotebook((current) => deleteStageProgram(current, id)); if (saved) playSound("erase", settings.muted); return saved; }}
        onMove={(id, direction) => changeNotebook((current) => moveStageProgram(current, id, direction))}
        onPlace={(id, target, position) => changeNotebook((current) => placeStageProgram(current, id, target, position))} />
    </PlayLayout>
    <PlayFooter onRestart={onNewChallenge ? () => setPopup("new") : undefined} disabled={saving || command.pending || !!failedSave} />
    {showChronicle && <CampaignChronicle run={run} stage={stage} settings={settings} onClose={() => setShowChronicle(false)} />}
    {popup === "help" && <PlayHelpDialog campaign advanced onClose={() => setPopup(null)} />}
    {popup === "settings" && <PlaySettingsDialog settings={settings} onChange={(next) => onSettingsChange?.(next)} onExport={() => downloadRun(live.current)} onNew={() => setPopup("new")} onClose={() => setPopup(null)} />}
    {popup === "share" && <PlayShareDialog text={shareText} includeNotes={shareInstructions} onIncludeNotes={setShareInstructions} notice={notice} onClose={() => setPopup(null)}
      onCopy={() => { void navigator.clipboard.writeText(shareText).then(() => setNotice("모험을 복사했어요."), () => setNotice("복사하지 못했어요. 위 내용을 직접 복사해 주세요.")); }}
      onSystemShare={typeof navigator.share === "function" ? () => { void navigator.share({ title: "죽을 때마다 한 줄", text: shareText }).catch(() => setNotice("공유를 취소했어요.")); } : undefined} />}
    {popup === "new" && <PlayRestartDialog disabled={saving || command.pending || !onNewChallenge}
      onRestart={() => { cancelCommand(); onNewChallenge?.(); }} onClose={() => setPopup(null)} />}
    {popup === "ending" && <Modal title="편지가 닿은 곳" onClose={() => setPopup(null)}><p>편지를 펼치자, 받는 사람 칸에 용사의 이름이 적혀 있었어요.</p><blockquote>여기까지는 내가 길을 적었어. 다음 길은 네가 골라 줘.</blockquote><p>종에 머물던 작은 불빛이 곁으로 돌아왔어요. 등지기도 조용히 기다리고 있었죠.</p><p>용사는 마지막 빈 줄에 적었어요. “이제는 같이 가자.”</p><button className="primary" onClick={onRoadmap}>여정 지도로</button></Modal>}
  </div>;
}
