import { STAGES } from "../campaign/catalog";
import type { CampaignState } from "../campaign/progress";
import type { StageId } from "../campaign/types";
import "./StageRoadmap.css";

interface StageRoadmapProps {
  campaign: CampaignState;
  busy?: boolean;
  onSelect: (id: StageId, mode: "resume" | "new") => void;
  onArchive: (id: StageId) => void;
  onClose?: () => void;
}
const SIGILS = ["◈", "≈", "◷", "❖", "❧", "✧", "⚖", "≋", "♧", "☾"];

export function StageRoadmap({ campaign, busy = false, onSelect, onArchive, onClose }: StageRoadmapProps) {
  const completed = campaign.stages.filter((stage) => stage.status === "completed").length;
  return (
    <section className="stage-roadmap" aria-labelledby="roadmap-title" aria-busy={busy}>
      <header className="roadmap-heading">
        <div>
          <p className="roadmap-eyebrow">A LETTER, TEN CHAPTERS</p>
          <h1 id="roadmap-title">편지가 닿을 때까지</h1>
          <p>지나온 길은 기억에 남고, 다음 문이 열립니다.</p>
        </div>
        {onClose ? <button type="button" className="subtle" onClick={onClose} disabled={busy}>모험으로 돌아가기</button> : null}
      </header>
      <p className="roadmap-progress" aria-live="polite">10개 장 중 {completed}개 완료 <span aria-hidden="true">·</span> 앞 장을 마치면 다음 장에 갈 수 있어요.</p>
      <ol className="roadmap-path">
        {STAGES.map((stage, index) => {
          const progress = campaign.stages.find((item) => item.stageId === stage.id);
          const locked = !progress || progress.status === "locked";
          const cleared = progress?.status === "completed";
          const resumable = progress?.activeRun !== null && progress?.activeRun !== undefined;
          const status = locked ? "잠김" : cleared ? "완료" : resumable ? "모험 중" : "열린 문";
          return (
            <li key={stage.id} className={`roadmap-stop ${locked ? "is-locked" : cleared ? "is-complete" : "is-open"}`}>
              <span className="roadmap-sigil" aria-hidden="true">{SIGILS[index]}</span>
              <div className="roadmap-card">
                <div className="roadmap-card-meta"><span>CHAPTER {String(stage.id).padStart(2, "0")}</span><span className="roadmap-status">{status}</span></div>
                <h2>{stage.title}</h2>
                <p>{stage.subtitle}</p><p className="roadmap-stage-count">{stage.segments}개 스테이지 · {stage.id}-1부터 {stage.id}-{stage.segments}까지</p>
                <div className="roadmap-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={locked || busy}
                    aria-describedby={locked ? `stage-${stage.id}-lock` : undefined}
                    onClick={() => { if (!locked) onSelect(stage.id, resumable ? "resume" : "new"); }}
                  >
                    {locked ? "아직 닫힌 문" : resumable ? "이어 걷기 →" : cleared ? "새 모험 시작 →" : "들어가기 →"}
                  </button>
                  {cleared ? <button type="button" className="subtle" onClick={() => onArchive(stage.id)} disabled={busy}>지난 메모 보기</button> : null}
                </div>
                {locked ? <small id={`stage-${stage.id}-lock`}>{stage.id - 1}장을 완료하면 열려요.</small> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="roadmap-footnote">완료한 장의 새 모험은 새 메모장으로 시작해요. 이전 기록과 열린 문은 그대로 남아요.</p>
    </section>
  );
}
