import { STAGES } from "../campaign/catalog";
import type { CampaignState } from "../campaign/progress";
import type { StageId } from "../campaign/types";
import { RoadmapIllustration } from "./RoadmapIllustration";
import "./StageRoadmap.css";

interface StageRoadmapProps {
  campaign: CampaignState;
  busy?: boolean;
  qa?: boolean;
  onSelect: (id: StageId, mode: "resume" | "new") => void;
  onArchive: (id: StageId) => void;
  onClose?: () => void;
}
const WHISPERS = [
  "잊어도 괜찮아요. 남겨 둔 한 줄이 길을 기억하니까.",
  "빗물에 젖지 않도록, 편지를 조금 더 꼭 쥐고.",
  "아무도 없는 부엌에서 아직 태엽 소리가 나요.",
  "멈춘 줄 알았던 바람이 먼 장치를 깨웁니다.",
  "발밑이 하늘이 되어도, 길은 이어져 있어요.",
  "낡은 찻잔은 어째서 두 사람 몫일까요?",
  "비어 있던 무대에 또 하나의 발소리가.",
  "보이지 않는 길에도, 누군가는 신호를 남겼어요.",
  "지나온 곳의 작은 움직임들이 하나의 종으로.",
  "마지막 문 너머로, 아직 전하지 못한 편지 한 통.",
];

export function StageRoadmap({ campaign, busy = false, qa = false, onSelect, onArchive, onClose }: StageRoadmapProps) {
  const completed = campaign.stages.filter((stage) => stage.status === "completed").length;
  const bookmark = [...campaign.stages].reverse().find((stage) => stage.activeRun && stage.status !== "locked")
    ?? campaign.stages.find((stage) => stage.status === "unlocked")
    ?? [...campaign.stages].reverse().find((stage) => stage.status === "completed");
  return (
    <section className="stage-roadmap storybook-roadmap" aria-labelledby="roadmap-title" aria-busy={busy}>
      <div className="roadmap-night" aria-hidden="true"><span className="roadmap-moon" /><i /><i /><i /><i /><i /></div>
      <header className="roadmap-heading">
        <div>
          <p className="roadmap-eyebrow">THE LITTLE COURIER’S TALE</p>
          <h1 id="roadmap-title">편지가 닿을 때까지</h1>
          <p>작은 용사의 주머니에, 아직 전하지 못한 편지 한 통.<br />당신이 남긴 한 줄을 따라 이야기는 계속됩니다.</p>
        </div>
        {onClose ? <button type="button" className="roadmap-return" onClick={onClose} disabled={busy}>← 모험으로 돌아가기</button> : null}
      </header>
      <div className="roadmap-book">
      <div className="roadmap-book-top">
        <div className="roadmap-letter" aria-hidden="true"><span>✦</span></div>
        <div><p className="roadmap-kicker">작은 배달부의 여정</p><h2>어디까지 걸어왔더라.</h2></div>
        <p className="roadmap-progress" aria-live="polite"><strong>{completed}</strong> / 10 <span>장에 남긴 발자국</span></p>
      </div>
      <p className="roadmap-book-invitation">지나온 길에는 기억이, 아직 가지 않은 길에는 이야기가.</p>
      {bookmark && <div className="roadmap-bookmark">
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <div><span>책갈피를 꽂아 둔 곳</span><strong>{STAGES[bookmark.stageId - 1].title}</strong></div>
        <button type="button" disabled={busy} onClick={() => onSelect(bookmark.stageId, bookmark.activeRun ? "resume" : "new")}>{bookmark.activeRun ? "이야기 이어가기" : completed === 10 ? "다시 펼치기" : "이 페이지 펼치기"}<span aria-hidden="true"> →</span></button>
      </div>}
      <ol className="roadmap-path">
        {STAGES.map((stage, index) => {
          const progress = campaign.stages.find((item) => item.stageId === stage.id);
          const locked = !progress || progress.status === "locked";
          const cleared = progress?.status === "completed";
          const resumable = progress?.activeRun !== null && progress?.activeRun !== undefined;
          const status = locked ? "잠김" : cleared ? "완료" : resumable ? "모험 중" : "열린 문";
          return (
            <li key={stage.id} className={`roadmap-stop ${locked ? "is-locked" : cleared ? "is-complete" : "is-open"} ${bookmark?.stageId === stage.id ? "is-bookmarked" : ""}`}>
              <div className="roadmap-vignette"><RoadmapIllustration chapter={stage.id} /><span className="roadmap-sigil" aria-hidden="true">{cleared ? "✓" : String(stage.id).padStart(2, "0")}</span></div>
              <div className="roadmap-card">
                <div className="roadmap-card-meta"><span>제 {stage.id} 장</span><span className="roadmap-status">{status}</span></div>
                <h2>{stage.title}</h2>
                <p className="roadmap-whisper">{WHISPERS[index]}</p><p className="roadmap-stage-count">{stage.segments}개의 작은 길</p>
                <div className="roadmap-actions">
                  <button
                    type="button"
                    className="roadmap-enter"
                    disabled={locked || busy}
                    aria-describedby={locked ? `stage-${stage.id}-lock` : undefined}
                    onClick={() => { if (!locked) onSelect(stage.id, resumable ? "resume" : "new"); }}
                  >
                    {locked ? "아직 닫힌 문" : resumable ? "이어 걷기 →" : cleared ? "새 모험 시작 →" : "들어가기 →"}
                  </button>
                  {cleared ? <button type="button" className="roadmap-archive" onClick={() => onArchive(stage.id)} disabled={busy}>지난 메모 보기</button> : null}
                </div>
                {locked ? <small id={`stage-${stage.id}-lock`}>{stage.id - 1}장을 완료하면 열려요.</small> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="roadmap-book-ending" aria-hidden="true">한 줄의 기억, 그리고 다음 페이지. <span>✧</span></div>
      </div>
      <p className="roadmap-footnote">{qa ? "QA 여행책에서는 모든 장을 바로 펼칠 수 있어요. 일반 모험의 기록과는 따로 보관됩니다." : "앞 장을 마치면 다음 장이 열립니다. 완료한 장의 새 모험은 새 메모장으로 시작해요. 이전 기록과 열린 문은 그대로 남아요."}</p>
    </section>
  );
}
