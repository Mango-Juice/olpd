import { postInterpretJson } from "./services/interpret-api";
import { useEffect, useMemo, useRef, useState } from "react";
import App, { type ChapterOneStorageBridge } from "./App";
import { StageRoadmap } from "./components/StageRoadmap";
import { CampaignPlay } from "./components/CampaignPlay";
import { CampaignRepository, type CampaignRepositoryResult, type CampaignRepositorySnapshot } from "./campaign/repository";
import { campaignAuthority, type CampaignStoredRun } from "./campaign/authority";
import { resolveStage } from "./campaign/registry";
import { createCampaignRun, type StageRun } from "./campaign/run";
import { parseProgram } from "./campaign/validation";
import { newChapterRun } from "./game/core";
import { makeSave, type StorageResult } from "./game/storage";
import { setAudioMuted } from "./game/audio";
import type { SaveData, Settings } from "./game/types";
import type { InstructionProgram, StageId } from "./campaign/types";

type Snapshot = CampaignRepositorySnapshot<CampaignStoredRun>;
type Route = { kind: "map" } | { kind: "legacy"; initial: SaveData | null; key: string } | { kind: "world"; stageId: StageId };
const authority = campaignAuthority(resolveStage);
function defaults(): Settings { return { muted: false, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches }; }
function recordId(run: CampaignStoredRun): string { return run.kind === "legacy" ? run.save.state.id : run.run.id; }
function revision(run: CampaignStoredRun): number { return run.kind === "legacy" ? run.save.state.revision : run.run.revision; }
function stageId(run: CampaignStoredRun): StageId { return run.kind === "legacy" ? 1 : run.run.stageId; }
function download(value: unknown, filename = "one-line-per-death-campaign.json"): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function interpret(text: string, run: StageRun, signal: AbortSignal): Promise<InstructionProgram> {
  const value = await postInterpretJson("/api/campaign-interpret", { text, stageId: run.stageId, runId: run.id, revision: run.revision, attempt: run.world.attempt, world: run.world }, signal);
  const program = value && typeof value === "object" && "program" in value ? parseProgram(value.program) : null;
  if (!program) throw new Error("해석 결과를 읽지 못했어요. 작성 기회는 그대로예요.");
  return program;
}
export default function CampaignShell() {
  const [writer] = useState(() => crypto.randomUUID());
  const [repository] = useState(() => new CampaignRepository(authority, { migrateLegacyRun: (save): CampaignStoredRun => ({ kind: "legacy", save }) }));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [route, setRoute] = useState<Route>({ kind: "map" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const conflicted = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const [finished, setFinished] = useState<StageRun | null>(null);
  const settings = snapshot?.state.settings ?? defaults();
  function accept(next: Snapshot) { snapshotRef.current = next; setSnapshot(next); }
  async function boot() {
    setError(""); setBusy(true);
    try {
      const loaded = await repository.loadOrCreate(writer);
      if (!loaded.ok) { setError(loaded.error.message); return; }
      accept(loaded.value); conflicted.current = false;
      if (loaded.value.state.stages[0].completion) setRoute({ kind: "map" });
      else {
        const active = loaded.value.activeRuns.find((item) => item.reference.stageId === 1)?.run;
        setRoute({ kind: "legacy", initial: active?.kind === "legacy" ? active.save : null, key: active ? recordId(active) : "first-prologue" });
      }
    } finally { setBusy(false); }
  }
  useEffect(() => { void boot(); }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const connection = new BroadcastChannel("one-line-per-death:campaign"); channel.current = connection;
    connection.onmessage = (event: MessageEvent<{ writer?: string; revision?: number }>) => {
      const current = snapshotRef.current;
      if (current && event.data.writer !== writer && typeof event.data.revision === "number" && event.data.revision > current.state.revision) {
        conflicted.current = true;
        setError("다른 창에서 모험 기록이 바뀌었어요. 최신 기록을 불러온 뒤 이어갈 수 있어요.");
      }
    };
    return () => { connection.close(); channel.current = null; };
  }, [writer]);
  useEffect(() => { setAudioMuted(settings.muted); }, [settings.muted]);
  async function mutate(operation: (current: Snapshot) => Promise<CampaignRepositoryResult<Snapshot>>): Promise<StorageResult<void>> {
    if (writing.current || conflicted.current || !snapshotRef.current) return { ok: false, error: { code: "conflict", message: "현재 기록을 다시 확인해 주세요." } };
    writing.current = true; setBusy(true);
    try {
      const result = await operation(snapshotRef.current);
      if (!result.ok) {
        if (result.error.code === "conflict") conflicted.current = true;
        setError(result.error.message);
        return { ok: false, error: { code: result.error.code === "conflict" ? "conflict" : "write", message: result.error.message } };
      }
      accept(result.value); setError("");
      channel.current?.postMessage({ writer, revision: result.value.state.revision });
      return { ok: true, value: undefined };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "기억을 보관하지 못했어요.";
      setError(message); return { ok: false, error: { code: "write", message, cause } };
    } finally { writing.current = false; setBusy(false); }
  }
  async function save(run: CampaignStoredRun): Promise<StorageResult<void>> {
    return mutate(async (current) => {
      const id = stageId(run);
      const active = current.activeRuns.find((item) => item.reference.stageId === id)?.run;
      if (active && recordId(active) === recordId(run) && revision(run) < revision(active)) return { ok: false, error: { code: "conflict", message: "이전 상태의 실행 결과는 저장하지 않았어요." } };
      const options = { writer, expected: { writer: current.state.writer, revision: current.state.revision }, ...(run.kind === "legacy" ? { settings: run.save.settings } : {}) };
      if (authority.isCleared(run)) {
        if (!active && current.state.stages[id - 1].completion?.run.runId === recordId(run)) {
          return run.kind === "legacy" ? repository.updateSettings(run.save.settings, options) : { ok: true, value: current };
        }
        return repository.completeActiveRun(run, options);
      }
      return repository.saveActiveRun(run, options);
    });
  }
  function map() { setFinished(null); setRoute({ kind: "map" }); }
  async function select(id: StageId, mode: "resume" | "new") {
    const current = snapshotRef.current;
    if (!current || current.state.stages[id - 1].status === "locked" || writing.current) return;
    const active = current.activeRuns.find((item) => item.reference.stageId === id)?.run;
    if (mode === "resume" && active) {
      setRoute(active.kind === "legacy" ? { kind: "legacy", initial: { ...active.save, settings }, key: active.save.state.id } : { kind: "world", stageId: id });
      return;
    }
    if (id === 1) {
      const fresh = makeSave(newChapterRun(), { writer, settings, tutorialCompleted: true });
      if ((await save({ kind: "legacy", save: fresh })).ok) setRoute({ kind: "legacy", initial: fresh, key: fresh.state.id });
    } else {
      const stage = resolveStage(id);
      if (!stage) { setError("이 장의 세계 정보를 불러오지 못했어요. 현재 기록은 그대로 남아 있어요."); return; }
      const fresh = createCampaignRun(crypto.randomUUID(), stage);
      if ((await save({ kind: "world", run: fresh })).ok) setRoute({ kind: "world", stageId: id });
    }
  }
  const bridge: ChapterOneStorageBridge | undefined = useMemo(() => route.kind !== "legacy" ? undefined : {
    initial: route.initial,
    save: (data) => save({ kind: "legacy", save: data }),
    onRoadmap: map,
    onClearedPresentation: map,
    bestScore: snapshot?.state.stages[0].bestScore ?? null,
  }, [route, snapshot?.state.stages[0].bestScore]);
  if (!snapshot) return <main className="stage-roadmap"><h1>모험의 기억을 펼치고 있어요</h1>{error ? <><p role="alert">{error}</p><button type="button" onClick={() => void boot()}>다시 불러오기</button></> : <p role="status">기존 기록을 확인하고 있어요…</p>}</main>;
  if (conflicted.current) return <main className="stage-roadmap"><h1>다른 창에서 이어진 모험</h1><p role="alert">{error}</p><button type="button" onClick={() => download(snapshot)}>이 창의 기록 보관하기</button><button type="button" onClick={() => void boot()}>최신 기록 불러오기</button></main>;
  if (route.kind === "legacy" && bridge) return <App key={route.key} bridge={bridge} />;
  const active: CampaignStoredRun | null | undefined = route.kind === "world" ? finished?.stageId === route.stageId ? { kind: "world", run: finished } : snapshot.activeRuns.find((item) => item.reference.stageId === route.stageId)?.run : null;
  const stage = active?.kind === "world" ? resolveStage(active.run.stageId) : null;
  const sharedHeader = <header className="campaign-controls" style={{ maxWidth: 1052, margin: "20px auto", padding: "0 24px" }}><button type="button" className="subtle" disabled={busy} onClick={() => void mutate((current) => repository.updateSettings({ ...settings, muted: !settings.muted }, { writer, expected: current.state }))}>{settings.muted ? "소리 켜기" : "소리 끄기"}</button><label><input type="checkbox" checked={settings.reducedMotion} disabled={busy} onChange={(event) => { const checked = event.target.checked; void mutate((current) => repository.updateSettings({ ...settings, reducedMotion: checked }, { writer, expected: current.state })); }} /> 움직임 줄이기</label>{error ? <p role="alert">{error}</p> : null}</header>;
  if (route.kind === "world" && active?.kind === "world" && stage) {
    return <CampaignPlay key={active.run.id} run={active.run} stage={stage} settings={settings} interpret={interpret}
      best={snapshot.state.stages[stage.id - 1].bestScore}
      onSettingsChange={(next) => { void mutate((current) => repository.updateSettings(next, { writer, expected: current.state })); }}
      onCommit={async (next) => {
        const result = await save({ kind: "world", run: next });
        if (result.ok && next.phase === "cleared") setFinished(next);
        return result.ok;
      }}
      onRoadmap={map}
      onNewChallenge={() => { setFinished(null); void select(stage.id, "new"); }} />;
  }
  const recoveredActive = snapshot.recoveries.filter((item) => item.kind === "active");
  const recoveryNotice = snapshot.recoveries.length ? <aside className="campaign-controls" style={{ maxWidth: 1004, margin: "0 auto 20px", padding: "16px 24px" }} role="status"><strong>개편 전 모험 기록을 따로 보관했어요.</strong><p>{recoveredActive.length ? `진행 중이던 ${recoveredActive.length}개 장은 원본을 남기고 새 기획으로 다시 시작해요. ` : ""}완료한 장과 열린 문은 그대로예요.</p><button type="button" className="subtle" onClick={() => download(snapshot.recoveries, "one-line-per-death-historical-runs.json")}>개편 전 원본 내려받기</button></aside> : null;
  return <>{sharedHeader}{recoveryNotice}<StageRoadmap campaign={snapshot.state} busy={busy} onSelect={(id, mode) => void select(id, mode)} /></>;
}
